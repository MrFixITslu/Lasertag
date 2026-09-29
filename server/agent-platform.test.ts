import { afterEach, describe, expect, it } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "./app";
import { buildDateChoices } from "../src/lib/booking";

const origin = "http://localhost:5173";
const secret = "combat-zone-platform-secret-123456789012345";
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function signed(pathname: string) {
  const timestamp = String(Date.now());
  const bodyHash = createHash("sha256").update("").digest("hex");
  const canonical = ["GET", pathname, timestamp, bodyHash].join("\n");
  return {
    "x-v79-service-id": "v79-hub",
    "x-v79-timestamp": timestamp,
    "x-v79-signature": createHmac("sha256", secret).update(canonical).digest("hex"),
  };
}

async function start() {
  const { app, db } = createApp({
    databasePath: ":memory:",
    adminUsername: "admin",
    adminPassword: "platform-test-password-long-enough",
    linkSecret: "separate-link-secret-for-platform-tests",
    platformSecret: secret,
    publicOrigin: origin,
    secureCookies: false,
    staticPath: "public",
  });
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  return { db, request: (path: string, init: RequestInit = {}) => fetch(base + path, init) };
}

describe("CombatZone signed Hub reporting", () => {
  it("rejects unsigned reads and returns booking signals to V79 Hub", async () => {
    const service = await start();
    const date = buildDateChoices(5)[4].value;
    const booking = {
      draft: { players: 12, missionId: "community-battle" },
      mission: { name: "Community Battle" },
      summary: { total: 720 },
    };
    service.db.prepare(
      "INSERT INTO bookings (id,reference,created_at,updated_at,status,date,time,start_ms,end_ms,name,email,payload,request_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(
      randomUUID(), "CZ-AGENT1", new Date().toISOString(), new Date().toISOString(),
      "confirmed", date, "09:00", Date.now() + 86400000, Date.now() + 90000000,
      "Test Organizer", "owner@example.test", JSON.stringify(booking), randomUUID(), "hash"
    );

    expect((await service.request("/api/platform/summary/v79")).status).toBe(401);

    const summaryPath = "/api/platform/summary/v79";
    const summary = await service.request(summaryPath, { headers: signed(summaryPath) });
    expect(summary.status).toBe(200);
    const body = await summary.json();
    expect(body.metrics.totalBookings).toBe(1);
    expect(body.metrics.upcomingPlayers).toBe(12);
    expect(body.upcoming[0].reference).toBe("CZ-AGENT1");

    const statsPath = "/api/platform/admin/stats";
    const stats = await service.request(statsPath, { headers: signed(statsPath) });
    expect(stats.status).toBe(200);
    expect((await stats.json()).totalBookings).toBe(1);
  });
});
