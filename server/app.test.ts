import { execFileSync } from "node:child_process";
import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { decryptMfaSecret, totpCode } from "./mfa";
import { buildDateChoices } from "../src/lib/booking";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

const password = "test-only-password-long-enough";
const linkSecret = "test-only-separate-link-secret-1234567890";
const origin = "http://localhost:5173";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
async function start(path = ":memory:", secureCookies = false) {
  const { app, db } = createApp({
    databasePath: path,
    adminPassword: password,
    adminUsername: "admin",
    staticPath: "public",
    publicOrigin: secureCookies ? "https://combatzone.example" : origin,
    secureCookies,
    linkSecret,
  });
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  let closed = false;
  async function close() {
    if (!closed) {
      closed = true;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      db.close();
    }
  }
  cleanups.push(close);
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        Origin: secureCookies ? "https://combatzone.example" : origin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const loginAs = async (username: string, passwordValue: string) => {
    const first = await request("/api/admin/login", "POST", {
      username,
      password: passwordValue,
    });
    expect(first.status).toBe(202);
    const challenge = await first.json();
    let secret = challenge.secret as string | undefined;
    if (!secret) {
      const userId =
        username === "admin"
          ? "owner"
          : (
              db.prepare("SELECT id FROM users WHERE email=?")
                .get(username.trim().toLowerCase()) as { id: string } | undefined
            )?.id;
      expect(userId).toBeTruthy();
      const record = db.prepare("SELECT secret_value FROM admin_mfa WHERE user_id=?")
        .get(userId!) as { secret_value: string } | undefined;
      expect(record).toBeTruthy();
      secret = decryptMfaSecret(record!.secret_value, linkSecret);
    }
    const response = await request("/api/admin/mfa/verify", "POST", {
      challengeToken: challenge.challengeToken,
      code: totpCode(secret!),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    return {
      auth: { Cookie: cookie, "X-CSRF-Token": body.csrf },
      body,
      response,
    };
  };
  const login = async () => (await loginAs("admin", password)).auth;
  return { request, login, loginAs, close, base, db };
}
function draft(overrides: Record<string, unknown> = {}) {
  return {
    missionId: "community-festival-play",
    players: 6,
    date: buildDateChoices(4)[3].value,
    time: "09:00",
    venueType: "field",
    area: "Gros Islet",
    address: "Test playing field",
    notes: "Test request",
    weatherFlexible: false,
    customer: {
      fullName: "Test Customer",
      email: "customer@example.com",
      phone: "+17585551234",
      marketingOptIn: false,
    },
    ...overrides,
  };
}
const key = () => ({ "Idempotency-Key": randomUUID() });
async function createOne(
  service: Awaited<ReturnType<typeof start>>,
  body = draft(),
) {
  const response = await service.request("/api/bookings", "POST", body, key());
  expect(response.status).toBe(201);
  return response.json();
}

describe("Booking API security and workflows", () => {
  it("requires strong configuration, authentication, origin checks and CSRF; revokes logout sessions", async () => {
    expect(() =>
      createApp({
        databasePath: ":memory:",
        adminUsername: "admin",
        adminPassword: "weak",
        publicOrigin: origin,
        secureCookies: false,
      }),
    ).toThrow();
    expect(() =>
      createApp({
        databasePath: ":memory:",
        adminUsername: "admin",
        adminPassword: password,
        publicOrigin: origin,
        secureCookies: false,
        linkSecret: "short",
      }),
    ).toThrow(/LINK_SECRET/);
    expect(() =>
      createApp({
        databasePath: ":memory:",
        adminUsername: "admin",
        adminPassword: password,
        publicOrigin: origin,
        secureCookies: false,
        linkSecret: password,
      }),
    ).toThrow(/LINK_SECRET/);
    const service = await start();
    expect((await service.request("/api/admin/bookings")).status).toBe(401);
    expect(
      (
        await service.request(
          "/api/admin/login",
          "POST",
          { username: "admin", password },
          { Origin: "https://attacker.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await service.request("/api/admin/login", "POST", {
          username: "admin",
          password: "wrong",
        })
      ).status,
    ).toBe(401);
    const auth = await service.login();
    expect(
      (await service.request("/api/admin/bookings", "GET", undefined, auth))
        .status,
    ).toBe(200);
    expect(
      (
        await service.request(
          "/api/admin/logout",
          "POST",
          {},
          { Cookie: auth.Cookie },
        )
      ).status,
    ).toBe(403);
    expect(
      (await service.request("/api/admin/logout", "POST", {}, auth)).status,
    ).toBe(200);
    expect(
      (await service.request("/api/admin/bookings", "GET", undefined, auth))
        .status,
    ).toBe(401);
  });
  it("requires TOTP after password, supports enrollment and one-time recovery codes", async () => {
    const service = await start();
    const first = await service.request("/api/admin/login", "POST", {
      username: "admin",
      password,
    });
    expect(first.status).toBe(202);
    expect(first.headers.get("set-cookie")).toBeNull();
    const setup = await first.json();
    expect(setup.twoFactorRequired).toBe(true);
    expect(setup.setupRequired).toBe(true);
    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.qrCode).toMatch(/^data:image\/png;base64,/);

    const wrong = await service.request("/api/admin/mfa/verify", "POST", {
      challengeToken: setup.challengeToken,
      code: "000000",
    });
    expect(wrong.status).toBe(401);

    const verified = await service.request("/api/admin/mfa/verify", "POST", {
      challengeToken: setup.challengeToken,
      code: totpCode(setup.secret),
    });
    expect(verified.status).toBe(200);
    const enrollment = await verified.json();
    expect(enrollment.recoveryCodes).toHaveLength(10);
    expect(verified.headers.get("set-cookie")).toContain("HttpOnly");

    const second = await service.request("/api/admin/login", "POST", {
      username: "admin",
      password,
    });
    expect(second.status).toBe(202);
    const challenge = await second.json();
    expect(challenge.setupRequired).toBe(false);
    expect(challenge.secret).toBeUndefined();
    expect(challenge.qrCode).toBeUndefined();

    const recovery = enrollment.recoveryCodes[0];
    const recovered = await service.request("/api/admin/mfa/verify", "POST", {
      challengeToken: challenge.challengeToken,
      code: recovery,
    });
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).recoveryCodeUsed).toBe(true);

    const third = await service.request("/api/admin/login", "POST", {
      username: "admin",
      password,
    });
    const thirdChallenge = await third.json();
    const reused = await service.request("/api/admin/mfa/verify", "POST", {
      challengeToken: thirdChallenge.challengeToken,
      code: recovery,
    });
    expect(reused.status).toBe(401);
  });

  it("uses secure, HttpOnly, SameSite cookies and throttles failed login attempts", async () => {
    const service = await start(":memory:", true);
    const completed = await service.loginAs("admin", password);
    expect(completed.response.headers.get("set-cookie")).toContain("Secure");
    expect(completed.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(completed.response.headers.get("set-cookie")).toContain("SameSite=Strict");
    for (let i = 0; i < 4; i++)
      expect(
        (
          await service.request("/api/admin/login", "POST", {
            username: "admin",
            password: "wrong",
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await service.request("/api/admin/login", "POST", {
          username: "admin",
          password: "wrong",
        })
      ).status,
    ).toBe(429);
  });
  it("persists requests, recalculates prices, deduplicates retries and exposes no public customer records", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cz-bookings-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "bookings.sqlite");
    const service = await start(path);
    const requestKey = key();
    const body = draft({
      summary: { totalPrice: 1 },
      status: "confirmed",
      internalNotes: "injected",
    });
    const first = await service.request(
      "/api/bookings",
      "POST",
      body,
      requestKey,
    );
    expect(first.status).toBe(201);
    const receipt = await first.json();
    expect(receipt.status).toBe("pending");
    expect(receipt.portalToken).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(receipt).sort()).toEqual(["portalToken", "reference", "status"]);
    const repeated = await service.request(
      "/api/bookings",
      "POST",
      body,
      requestKey,
    );
    expect((await repeated.json()).reference).toBe(receipt.reference);
    expect(
      (
        await service.request(
          "/api/bookings",
          "POST",
          draft({ players: 12 }),
          requestKey,
        )
      ).status,
    ).toBe(409);
    const auth = await service.login();
    const list = await (
      await service.request("/api/admin/bookings", "GET", undefined, auth)
    ).json();
    expect(list.total).toBe(1);
    const item = await (
      await service.request(
        `/api/admin/bookings/${list.bookings[0].id}`,
        "GET",
        undefined,
        auth,
      )
    ).json();
    expect(item.summary.totalPrice).toBe(680);
    expect(item.summary.activationFee).toBe(500);
    expect(item.summary.baseDurationMinutes).toBe(15);
    expect(item.internalNotes).toBe("");
    expect((await service.request(`/api/bookings/${item.id}`)).status).toBe(
      404,
    );
    expect(
      (await service.request(`/api/admin/bookings/${item.id}`)).status,
    ).toBe(401);
    await service.close();
    const restarted = await start(path);
    expect(
      (await restarted.request("/api/admin/session", "GET", undefined, auth))
        .status,
    ).toBe(401);
    const newAuth = await restarted.login();
    const persisted = await (
      await restarted.request("/api/admin/bookings", "GET", undefined, newAuth)
    ).json();
    expect(persisted.total).toBe(1);
    expect(persisted.bookings[0].reference).toBe(receipt.reference);
  });
  it("creates a secure registration portal with roster and balanced teams", async () => {
    const service = await start();
    const response = await service.request("/api/bookings", "POST", draft({
      missionId: "corporate-team-battle",
      players: 15,
      venueType: "event",
      eventDetails: {
        eventName: "Finance Team Challenge",
        organization: "Test Company",
        groupType: "corporate",
        ageGroup: "adults",
        emergencyContactName: "Event Lead",
        emergencyContactPhone: "+17585550000",
        objectives: "Team building",
        accessibilityNotes: "",
        photoConsent: false,
        participantNames: ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O"],
      },
    }), key());
    expect(response.status).toBe(201);
    const receipt = await response.json();
    const portal = await service.request(`/api/portal/${receipt.portalToken}`);
    expect(portal.status).toBe(200);
    const data = await portal.json();
    expect(data.profile.eventName).toBe("Finance Team Challenge");
    expect(data.registeredPlayers).toBe(15);
    expect(data.rosterTeamSizes).toEqual([5, 5, 5]);
    expect(new Set(data.participants.map((p: any) => p.teamIndex))).toEqual(new Set([0,1,2]));

    const added = await service.request(
      `/api/portal/${receipt.portalToken}/participants`,
      "POST",
      { name: "Late Player", waiverSigned: true },
    );
    expect(added.status).toBe(201);
    const after = await added.json();
    expect(after.registeredPlayers).toBe(16);
    expect(after.rosterTeamSizes).toEqual([6, 5, 5]);

    const auth = await service.login();
    const randomized = await service.request(
      `/api/admin/events/${data.bookingId}/rebalance`,
      "POST",
      { randomize: true },
      auth,
    );
    expect(randomized.status).toBe(200);
    const locked = await service.request(
      `/api/admin/events/${data.bookingId}/lock`,
      "POST",
      { locked: true },
      auth,
    );
    expect(locked.status).toBe(200);
    expect((await locked.json()).profile.rosterLocked).toBe(true);
    expect(
      (
        await service.request(
          `/api/portal/${receipt.portalToken}/participants`,
          "POST",
          { name: "Blocked Player" },
        )
      ).status,
    ).toBe(409);
  });
  it("runs Mission Control from check-in through scoring equipment and incidents", async () => {
    const service = await start();
    const names = Array.from({ length: 15 }, (_, index) => `Player ${index + 1}`);
    const bookingResponse = await service.request("/api/bookings", "POST", draft({
      missionId: "corporate-team-battle",
      players: 15,
      venueType: "event",
      eventDetails: {
        eventName: "Operations Challenge",
        organization: "Test Company",
        groupType: "corporate",
        ageGroup: "adults",
        emergencyContactName: "Event Lead",
        emergencyContactPhone: "+17585550000",
        objectives: "Teamwork",
        accessibilityNotes: "",
        photoConsent: false,
        participantNames: names,
      },
    }), key());
    const receipt = await bookingResponse.json();
    const portal = await (await service.request(`/api/portal/${receipt.portalToken}`)).json();
    const auth = await service.login();

    for (const person of portal.participants.slice(0, 12)) {
      expect((
        await service.request(
          `/api/admin/events/${portal.bookingId}/participants/${person.id}`,
          "PATCH",
          { checkedIn: true },
          auth,
        )
      ).status).toBe(200);
    }

    const assigned = await service.request(
      `/api/admin/events/${portal.bookingId}/equipment/auto-assign`,
      "POST",
      {},
      auth,
    );
    expect(assigned.status).toBe(200);
    const assignedData = await assigned.json();
    const codes = assignedData.participants.filter((p: any) => p.equipmentCode).map((p: any) => p.equipmentCode);
    expect(codes).toHaveLength(12);
    expect(new Set(codes).size).toBe(12);

    const schedule = await service.request(
      `/api/admin/events/${portal.bookingId}/rounds/generate`,
      "POST",
      { mode: "Team Battle", durationMinutes: 10 },
      auth,
    );
    expect(schedule.status).toBe(200);
    const scheduled = await schedule.json();
    expect(scheduled.rounds).toHaveLength(3);
    expect(scheduled.profile.eventStatus).toBe("ready");

    const firstRound = scheduled.rounds[0];
    const started = await service.request(
      `/api/admin/events/${portal.bookingId}/rounds/${firstRound.id}`,
      "PATCH",
      { action: "start" },
      auth,
    );
    expect(started.status).toBe(200);
    expect((await started.json()).rounds[0].status).toBe("live");

    const completed = await service.request(
      `/api/admin/events/${portal.bookingId}/rounds/${firstRound.id}`,
      "PATCH",
      { action: "complete", scoreA: 5, scoreB: 3, objectiveA: 1, objectiveB: 0, notes: "Clean round" },
      auth,
    );
    expect(completed.status).toBe(200);
    const scored = await completed.json();
    expect(scored.rounds[0].status).toBe("completed");
    expect(scored.leaderboard[0].points).toBe(3);

    const final = await service.request(
      `/api/admin/events/${portal.bookingId}/final`,
      "POST",
      { durationMinutes: 10 },
      auth,
    );
    expect(final.status).toBe(200);
    expect((await final.json()).rounds.at(-1).mode).toBe("Championship Final");

    const incident = await service.request(
      `/api/admin/events/${portal.bookingId}/incidents`,
      "POST",
      { kind: "equipment", note: "Tagger swapped during setup." },
      auth,
    );
    expect(incident.status).toBe(201);
    const incidentData = await incident.json();
    expect(incidentData.incidents[0].resolved).toBe(false);

    const gear = incidentData.equipment[0];
    expect((
      await service.request(
        `/api/admin/equipment/${gear.code}`,
        "PATCH",
        { status: "charging", battery: 40, notes: "Recharge before next event" },
        auth,
      )
    ).status).toBe(200);
    const refreshed = await (await service.request(`/api/admin/events/${portal.bookingId}`, "GET", undefined, auth)).json();
    expect(refreshed.equipment[0].status).toBe("charging");
    expect(refreshed.equipment[0].battery).toBe(40);
  });
  it("persists balanced corporate teams and their match rotation", async () => {
    const service = await start();
    await createOne(service, draft({
      missionId: "corporate-team-battle",
      players: 15,
      venueType: "event",
    }));
    const auth = await service.login();
    const list = await (
      await service.request("/api/admin/bookings", "GET", undefined, auth)
    ).json();
    const item = await (
      await service.request(
        `/api/admin/bookings/${list.bookings[0].id}`,
        "GET",
        undefined,
        auth,
      )
    ).json();
    expect(item.summary.teamCount).toBe(3);
    expect(item.summary.teamSizes).toEqual([5, 5, 5]);
    expect(item.summary.matchRotation).toHaveLength(3);
    expect(item.summary.matchRotation.flat().sort()).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it("flags above-standard groups for quotation without extending fixed package play time", async () => {
    const service = await start();
    await createOne(service, draft({
      missionId: "school-youth-battle",
      players: 21,
      venueType: "community",
    }));
    const auth = await service.login();
    const list = await (
      await service.request("/api/admin/bookings", "GET", undefined, auth)
    ).json();
    const item = await (
      await service.request(
        `/api/admin/bookings/${list.bookings[0].id}`,
        "GET",
        undefined,
        auth,
      )
    ).json();
    expect(item.summary.customQuoteRequired).toBe(true);
    expect(item.summary.totalMissionMinutes).toBe(90);
    expect(item.summary.rotationExtensionMinutes).toBe(0);
    expect(item.summary.depositPercent).toBe(0);
    expect(item.summary.operationalBufferMinutes).toBe(60);
  });
  it("rejects invalid customers, dates, times and player counts", async () => {
    const service = await start();
    for (const body of [
      draft({ players: -1 }),
      draft({ players: 6.5 }),
      draft({ players: 61 }),
      draft({ missionId: "fake" }),
      draft({ date: "2020-01-01" }),
      draft({ time: "23:00" }),
      draft({ customer: null }),
      draft({ weatherFlexible: "false" }),
      draft({ address: "" }),
    ]) {
      expect(
        (await service.request("/api/bookings", "POST", body, key())).status,
      ).toBe(400);
    }
  });
  it("guards confirmations against overlap and stale edits, records history, and supports filters", async () => {
    const service = await start();
    await createOne(service);
    await createOne(service, draft({ time: "10:00" }));
    const auth = await service.login();
    const list = await (
      await service.request("/api/admin/bookings", "GET", undefined, auth)
    ).json();
    const [one, two] = list.bookings;
    const update = (id: string, fields: Record<string, unknown>) =>
      service.request(
        `/api/admin/bookings/${id}`,
        "PATCH",
        {
          status: "confirmed",
          date: one.date,
          time: "09:00",
          internalNotes: "Private setup note",
          version: 1,
          ...fields,
        },
        auth,
      );
    const confirmed = await update(one.id, {});
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).history[0].message).toContain("confirmed");
    expect(
      (await update(one.id, { internalNotes: "Stale overwrite" })).status,
    ).toBe(409);
    expect((await update(two.id, { time: "10:00" })).status).toBe(409); // 15 minutes plus 60 minute buffer overlaps.
    expect((await update(two.id, { time: "11:00" })).status).toBe(200);
    expect(
      (await update(one.id, { status: "completed", version: 2 })).status,
    ).toBe(400);
    const filtered = await (
      await service.request(
        `/api/admin/bookings?status=confirmed&q=${one.reference}`,
        "GET",
        undefined,
        auth,
      )
    ).json();
    expect(filtered.total).toBe(1);
    expect(
      (await update(one.id, { status: "cancelled", version: 2 })).status,
    ).toBe(200);
    const rebook = await update(two.id, { time: "09:00", version: 2 });
    expect(rebook.status).toBe(200);
    const final = await rebook.json();
    expect(final.draft.time).toBe("09:00");
    expect(final.history).toHaveLength(3);
  });
});

describe("business permissions and income", () => {
  it("enforces staff boundaries, finance grants and immediate revocation on every endpoint", async () => {
    const service = await start(),
      owner = await service.login();
    const created = await service.request(
      "/api/admin/users",
      "POST",
      {
        email: "crew@example.com",
        name: "Crew Member",
        password,
        role: "staff",
        finance: false,
      },
      owner,
    );
    expect(created.status).toBe(201);
    const user = await created.json();
    const loginStaff = async () =>
      service.loginAs("crew@example.com", password);
    let staff = await loginStaff();
    expect(staff.body.finance).toBe(false);
    for (const endpoint of [
      "users",
      "finance",
      "contacts",
      "campaigns",
      "content",
      "media",
      "connections",
      "audit",
      "social-posts",
    ])
      expect(
        (
          await service.request(
            "/api/admin/" + endpoint,
            "GET",
            undefined,
            staff.auth,
          )
        ).status,
      ).toBe(403);
    expect(
      (
        await service.request(
          "/api/admin/users",
          "POST",
          { role: "admin" },
          staff.auth,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await service.request("/api/bookings", "POST", draft(), {
          "Idempotency-Key": randomUUID(),
        })
      ).status,
    ).toBe(201);
    const list = await (
      await service.request("/api/admin/bookings", "GET", undefined, staff.auth)
    ).json();
    const id = list.bookings[0].id;
    const detail = await (
      await service.request(
        `/api/admin/bookings/${id}`,
        "GET",
        undefined,
        staff.auth,
      )
    ).json();
    expect(detail.summary.totalPrice).toBeUndefined();
    expect(detail.mission.price).toBeUndefined();
    const updated = await service.request(
      `/api/admin/bookings/${id}`,
      "PATCH",
      {
        version: 1,
        status: "pending",
        date: detail.draft.date,
        time: detail.draft.time,
        internalNotes: "Crew setup",
      },
      staff.auth,
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).summary.totalPrice).toBeUndefined();
    expect(
      (
        await service.request(
          `/api/admin/users/${user.id}`,
          "PATCH",
          { role: "staff", finance: true, active: true },
          owner,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await service.request(
          "/api/admin/finance",
          "GET",
          undefined,
          staff.auth,
        )
      ).status,
    ).toBe(401);
    staff = await loginStaff();
    expect(staff.body.finance).toBe(true);
    expect(
      (
        await service.request(
          "/api/admin/finance",
          "GET",
          undefined,
          staff.auth,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await service.request(
          "/api/admin/content",
          "GET",
          undefined,
          staff.auth,
        )
      ).status,
    ).toBe(403);
    await service.request(
      `/api/admin/users/${user.id}`,
      "PATCH",
      { role: "staff", finance: false, active: false },
      owner,
    );
    expect(
      (
        await service.request(
          "/api/admin/bookings",
          "GET",
          undefined,
          staff.auth,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await service.request("/api/admin/login", "POST", {
          username: "crew@example.com",
          password,
        })
      ).status,
    ).toBe(401);
  });
  it("keeps a precise, idempotent payment/refund ledger separate from estimates", async () => {
    const service = await start(),
      auth = await service.login();
    await service.request("/api/bookings", "POST", draft(), {
      "Idempotency-Key": randomUUID(),
    });
    const booking = (
      await (
        await service.request("/api/admin/bookings", "GET", undefined, auth)
      ).json()
    ).bookings[0];
    const payment = {
      bookingId: booking.id,
      cents: 10001,
      kind: "payment",
      method: "Cash",
      receivedOn: new Date().toLocaleDateString("en-CA", {
        timeZone: "America/St_Lucia",
      }),
      note: "Deposit",
      requestKey: randomUUID(),
    };
    expect(
      (
        await service.request(
          "/api/admin/finance/payments",
          "POST",
          payment,
          auth,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await service.request(
          "/api/admin/finance/payments",
          "POST",
          payment,
          auth,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await service.request(
          "/api/admin/finance/payments",
          "POST",
          { ...payment, cents: 20000 },
          auth,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await service.request(
          "/api/admin/finance/payments",
          "POST",
          {
            ...payment,
            cents: 10002,
            kind: "refund",
            requestKey: randomUUID(),
          },
          auth,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await service.request(
          "/api/admin/finance/payments",
          "POST",
          { ...payment, cents: 1.5, requestKey: randomUUID() },
          auth,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await service.request(
          "/api/admin/finance/payments",
          "POST",
          { ...payment, cents: 2501, kind: "refund", requestKey: randomUUID() },
          auth,
        )
      ).status,
    ).toBe(201);
    const result = await (
      await service.request("/api/admin/finance", "GET", undefined, auth)
    ).json();
    expect(result.ledger).toHaveLength(2);
    expect(result.bookings[0].paid).toBe(7500);
    expect(Object.values(result.totals)).toEqual([
      { received: 10001, refunded: 2501, net: 7500 },
    ]);
    expect(
      (
        await service.request(
          "/api/admin/finance?from=2026-12-31&to=2026-01-01",
          "GET",
          undefined,
          auth,
        )
      ).status,
    ).toBe(400);
  });
});
describe("marketing workspace", () => {
  it("publishes only live events, protects drafts and handles stale edits", async () => {
    const service = await start(),
      auth = await service.login();
    const event = {
      kind: "event",
      title: "Community mission",
      body: "Join the squad.",
      eventDate: buildDateChoices(2)[1].value,
      location: "Gros Islet",
      live: false,
      design: { headline: "GAME ON" },
    };
    const created = await service.request(
      "/api/admin/content",
      "POST",
      event,
      auth,
    );
    expect(created.status).toBe(200);
    const { id } = await created.json();
    expect(await (await service.request("/api/events")).json()).toEqual([]);
    expect((await service.request("/api/admin/content")).status).toBe(401);
    expect(
      (
        await service.request(
          "/api/admin/content",
          "POST",
          { ...event, id, version: 1, live: true },
          auth,
        )
      ).status,
    ).toBe(200);
    expect((await (await service.request("/api/events")).json())[0].title).toBe(
      event.title,
    );
    expect(
      (
        await service.request(
          "/api/admin/content",
          "POST",
          { ...event, id, version: 1 },
          auth,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await service.request(
          `/api/admin/content/${id}/publish`,
          "POST",
          { platform: "facebook", confirm: true },
          auth,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await service.request(
          "/api/admin/content",
          "POST",
          { ...event, id, version: 2, live: false },
          auth,
        )
      ).status,
    ).toBe(200);
    expect(await (await service.request("/api/events")).json()).toEqual([]);
  });
  it("imports only opt-ins, deduplicates and never re-enables suppressed contacts", async () => {
    const service = await start(),
      auth = await service.login();
    const opted = draft();
    (opted.customer as any).marketingOptIn = true;
    await service.request("/api/bookings", "POST", opted, {
      "Idempotency-Key": randomUUID(),
    });
    const no = draft();
    (no.customer as any).email = "no@example.com";
    (no.customer as any).marketingOptIn = false;
    await service.request("/api/bookings", "POST", no, {
      "Idempotency-Key": randomUUID(),
    });
    const imported = await service.request(
      "/api/admin/contacts/import-bookings",
      "POST",
      {},
      auth,
    );
    expect((await imported.json()).imported).toBe(1);
    const rows = await (
      await service.request("/api/admin/contacts", "GET", undefined, auth)
    ).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBeUndefined();
    await service.request(
      `/api/admin/contacts/${rows[0].id}/unsubscribe`,
      "POST",
      {},
      auth,
    );
    await service.request(
      "/api/admin/contacts/import-bookings",
      "POST",
      {},
      auth,
    );
    const after = await (
      await service.request("/api/admin/contacts", "GET", undefined, auth)
    ).json();
    expect(after[0].subscribed).toBe(0);
    expect(
      (
        await service.request(
          "/api/admin/contacts",
          "POST",
          {
            email: rows[0].email,
            name: "Test",
            segment: "clients",
            basis: "Explicit consent",
          },
          auth,
        )
      ).status,
    ).toBe(409);
    const campaign = await (
      await service.request(
        "/api/admin/campaigns",
        "POST",
        {
          subject: "Hello squad",
          body: "A welcome to CombatZone SLU.",
          segment: "",
        },
        auth,
      )
    ).json();
    expect(
      (
        await service.request(
          `/api/admin/campaigns/${campaign.id}/send`,
          "POST",
          { confirm: true },
          auth,
        )
      ).status,
    ).toBe(503);
  });
});

describe("KPI measurement and media workflows", () => {
  it("deduplicates tracking and calculates conversion without exposing financial KPIs to staff", async () => {
    const service = await start(),
      auth = await service.login(),
      visitId = randomUUID();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await service.request("/api/analytics", "POST", {
            visitId,
            event: "landing",
          })
        ).status,
      ).toBe(204);
    await service.request("/api/analytics", "POST", {
      visitId,
      event: "booking_started",
    });
    await service.request(
      "/api/bookings",
      "POST",
      { ...draft(), visitId },
      { "Idempotency-Key": randomUUID() },
    );
    const data = await (
      await service.request("/api/admin/kpis", "GET", undefined, auth)
    ).json();
    expect(
      data.operations.cards.find((c: any) => c.id === "requests").value,
    ).toBe(1);
    expect(data.marketing.cards.find((c: any) => c.id === "visits").value).toBe(
      1,
    );
    expect(
      data.marketing.cards.find((c: any) => c.id === "conversionRate").value,
    ).toBe(100);
    expect(
      data.operations.cards.find((c: any) => c.id === "responseHours").value,
    ).toBeNull();
    expect(
      (
        await service.request(
          "/api/admin/kpis?from=2026-02-30&to=2026-03-01",
          "GET",
          undefined,
          auth,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await service.request(
          "/api/admin/kpi-targets",
          "PUT",
          { key: "confirmationRate", value: 101 },
          auth,
        )
      ).status,
    ).toBe(400);
    await service.request(
      "/api/admin/kpi-targets",
      "PUT",
      { key: "confirmationRate", value: 80 },
      auth,
    );
    await service.request(
      "/api/admin/users",
      "POST",
      {
        email: "kpi@example.com",
        name: "KPI Crew",
        password,
        role: "staff",
        finance: false,
      },
      auth,
    );
    const staffLogin = await service.loginAs("kpi@example.com", password);
    const staff = staffLogin.auth;
    const privateData = await (
      await service.request("/api/admin/kpis", "GET", undefined, staff)
    ).json();
    expect(privateData.finance).toBeUndefined();
    expect(privateData.marketing).toBeUndefined();
    expect(privateData.operations.cards.length).toBeGreaterThan(5);
    expect(
      (
        await service.request(
          "/api/admin/kpi-targets",
          "PUT",
          { key: "requests", value: 20 },
          staff,
        )
      ).status,
    ).toBe(403);
  });
  it("normalises media, protects unpublished uploads and keeps original landing assets accessible", async () => {
    const folder = mkdtempSync(join(tmpdir(), "cz-media-"));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const service = await start(join(folder, "db.sqlite")),
      auth = await service.login();
    const upload = async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(service.base + "/api/admin/media", {
        method: "POST",
        headers: { Origin: origin, ...auth },
        body: form,
      });
    };
    const invalid = await upload(
      new File(['<svg onload="alert(1)"></svg>'], "fake.jpg", {
        type: "image/jpeg",
      }),
    );
    expect(invalid.status).toBe(400);
    const videoPath = join(folder, "short.webm");
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=96x96:r=10",
      "-t",
      "0.5",
      "-c:v",
      "libvpx-vp9",
      videoPath,
    ]);
    const video = await upload(
      new File([readFileSync(videoPath)], "short.webm", { type: "video/webm" }),
    );
    expect(video.status).toBe(201);
    const videoId = (await video.json()).id;
    const normalised = await service.request(
      `/api/admin/media/${videoId}`,
      "GET",
      undefined,
      auth,
    );
    expect(normalised.headers.get("content-type")).toContain("video/mp4");
    const valid = await upload(
      new File(
        [readFileSync("public/media/netronic-falcon.webp")],
        "falcon.webp",
        { type: "image/webp" },
      ),
    );
    expect(valid.status).toBe(201);
    const { id } = await valid.json();
    expect((await service.request(`/uploads/${id}`)).status).toBe(404);
    const image = await service.request(
      `/api/admin/media/${id}`,
      "GET",
      undefined,
      auth,
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/jpeg");
    await service.request(
      "/api/admin/content",
      "POST",
      {
        kind: "event",
        title: "Live game",
        body: "Bring your squad.",
        eventDate: buildDateChoices(2)[1].value,
        location: "Gros Islet",
        mediaId: id,
        live: true,
      },
      auth,
    );
    expect((await service.request(`/uploads/${id}`)).status).toBe(200);
    // This /media path must fall through to the static server, not private uploads.
    const existing = await service.request("/media/netronic-falcon.webp");
    expect(existing.status).toBe(200);
  });
  it("sends personalised campaigns once, tracks CTA clicks and honours unsubscribe links", async () => {
    vi.stubEnv("SMTP_HOST", "test.invalid");
    vi.stubEnv("SMTP_FROM", "CombatZone <mail@example.com>");
    vi.stubEnv("MAIL_BUSINESS_ADDRESS", "Gros Islet, Saint Lucia");
    const sendMail = vi
      .fn()
      .mockResolvedValue({ accepted: ["person@example.com"] });
    const close = vi.fn();
    const mock = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({ sendMail, close } as any);
    cleanups.push(() => {
      mock.mockRestore();
      vi.unstubAllEnvs();
    });
    const service = await start(),
      auth = await service.login();
    await service.request(
      "/api/admin/contacts",
      "POST",
      {
        email: "person@example.com",
        name: "Neil <test>",
        segment: "hotels",
        basis: "Requested an introduction",
      },
      auth,
    );
    const c = await (
      await service.request(
        "/api/admin/campaigns",
        "POST",
        {
          subject: "Mission invite",
          body: "Hi {{name}}, join your next mission.",
          segment: "hotels",
        },
        auth,
      )
    ).json();
    expect(
      (
        await service.request(
          `/api/admin/campaigns/${c.id}/send`,
          "POST",
          { confirm: true },
          auth,
        )
      ).status,
    ).toBe(202);
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    expect(sendMail.mock.calls[0][0].html).toContain("Neil &lt;test&gt;");
    expect(sendMail.mock.calls[0][0].to).toBe("person@example.com");
    expect(
      (
        await service.request(
          `/api/admin/campaigns/${c.id}/send`,
          "POST",
          { confirm: true },
          auth,
        )
      ).status,
    ).toBe(409);
    const contact = service.db.prepare("SELECT * FROM contacts").get() as any;
    const click = await fetch(
      `${service.base}/campaign-click/${c.id}/${contact.token}`,
      { redirect: "manual" },
    );
    expect(click.status).toBe(302);
    expect(click.headers.get("location")).toContain(`campaign=${c.id}`);
    const kpis = await (
      await service.request("/api/admin/kpis", "GET", undefined, auth)
    ).json();
    expect(
      kpis.marketing.cards.find((r: any) => r.id === "clickRate").value,
    ).toBe(100);
    await service.request(`/unsubscribe/${contact.token}`, "POST");
    expect(
      (service.db.prepare("SELECT subscribed FROM contacts").get() as any)
        .subscribed,
    ).toBe(0);
    const copy = await (
      await service.request(
        "/api/admin/campaigns",
        "POST",
        {
          subject: "Second invite",
          body: "Join a second mission.",
          segment: "hotels",
        },
        auth,
      )
    ).json();
    expect(
      (
        await service.request(
          `/api/admin/campaigns/${copy.id}/send`,
          "POST",
          { confirm: true },
          auth,
        )
      ).status,
    ).toBe(400);
  });
});
