import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { buildBalancedTeams } from "../src/lib/booking";
import type { BookingDraft, BookingSummary } from "../src/types";

type Row = Record<string, any>;
type Helpers = {
  fail: (status: number, message: string) => never;
  text: (value: unknown, name: string, max: number, min?: number) => string;
  getBooking: (id: string) => Row;
};

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const tokenPattern = /^[a-f0-9]{64}$/i;

function safeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function balancedRosterSizes(count: number) {
  if (count <= 0) return [] as number[];
  if (count === 1) return [1];
  return buildBalancedTeams(count);
}
function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function initOperations(db: DatabaseSync, publicOrigin: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_portals(
      booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_profiles(
      booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      group_type TEXT NOT NULL DEFAULT 'other',
      age_group TEXT NOT NULL DEFAULT 'mixed',
      objectives TEXT NOT NULL DEFAULT '',
      accessibility_notes TEXT NOT NULL DEFAULT '',
      emergency_contact_name TEXT NOT NULL DEFAULT '',
      emergency_contact_phone TEXT NOT NULL DEFAULT '',
      photo_consent INTEGER NOT NULL DEFAULT 0,
      roster_locked INTEGER NOT NULL DEFAULT 0,
      event_status TEXT NOT NULL DEFAULT 'registration',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS participants(
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      guardian_name TEXT NOT NULL DEFAULT '',
      guardian_phone TEXT NOT NULL DEFAULT '',
      waiver_signed INTEGER NOT NULL DEFAULT 0,
      checked_in INTEGER NOT NULL DEFAULT 0,
      team_index INTEGER NOT NULL DEFAULT -1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS participants_booking ON participants(booking_id,active,team_index);
  `);

  function newPortalToken(bookingId: string) {
    const token = randomBytes(32).toString("hex");
    const stamp = now();
    db.prepare(`
      INSERT INTO booking_portals(booking_id,token_hash,created_at,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(booking_id) DO UPDATE SET token_hash=excluded.token_hash,updated_at=excluded.updated_at
    `).run(bookingId, digest(token), stamp, stamp);
    return token;
  }

  function rebalance(bookingId: string, randomize = false) {
    let participants = db.prepare(
      "SELECT id FROM participants WHERE booking_id=? AND active=1 ORDER BY created_at,id"
    ).all(bookingId) as Row[];
    if (randomize) participants = shuffle(participants);
    const sizes = balancedRosterSizes(participants.length);
    let cursor = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      sizes.forEach((size, teamIndex) => {
        for (let n = 0; n < size; n += 1) {
          const participant = participants[cursor++];
          if (participant) db.prepare("UPDATE participants SET team_index=?,updated_at=? WHERE id=?")
            .run(teamIndex, now(), participant.id);
        }
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return sizes;
  }

  function createBookingPortal(
    bookingId: string,
    draft: BookingDraft,
    summary: BookingSummary,
  ) {
    const token = newPortalToken(bookingId);
    const details = draft.eventDetails;
    const stamp = now();
    db.prepare(`
      INSERT INTO event_profiles(
        booking_id,event_name,organization,group_type,age_group,objectives,
        accessibility_notes,emergency_contact_name,emergency_contact_phone,
        photo_consent,roster_locked,event_status,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,0,'registration',?)
      ON CONFLICT(booking_id) DO UPDATE SET
        event_name=excluded.event_name,organization=excluded.organization,
        group_type=excluded.group_type,age_group=excluded.age_group,
        objectives=excluded.objectives,accessibility_notes=excluded.accessibility_notes,
        emergency_contact_name=excluded.emergency_contact_name,
        emergency_contact_phone=excluded.emergency_contact_phone,
        photo_consent=excluded.photo_consent,updated_at=excluded.updated_at
    `).run(
      bookingId,
      details?.eventName ?? "",
      details?.organization ?? "",
      details?.groupType ?? "other",
      details?.ageGroup ?? "mixed",
      details?.objectives ?? "",
      details?.accessibilityNotes ?? "",
      details?.emergencyContactName ?? draft.customer.fullName,
      details?.emergencyContactPhone ?? draft.customer.phone,
      details?.photoConsent ? 1 : 0,
      stamp,
    );
    const names = (details?.participantNames ?? [])
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, Math.min(60, draft.players));
    for (const name of names) {
      db.prepare(`
        INSERT INTO participants(id,booking_id,name,created_at,updated_at)
        VALUES(?,?,?,?,?)
      `).run(randomUUID(), bookingId, name.slice(0, 120), stamp, stamp);
    }
    if (names.length) rebalance(bookingId);
    return { token, expectedTeams: summary.teamSizes };
  }

  function portalBooking(rawToken: string) {
    if (!tokenPattern.test(rawToken)) return undefined;
    return db.prepare(`
      SELECT b.* FROM booking_portals p
      JOIN bookings b ON b.id=p.booking_id
      WHERE p.token_hash=?
    `).get(digest(rawToken)) as Row | undefined;
  }

  function eventData(bookingId: string, includePrivate = false) {
    const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId) as Row | undefined;
    if (!booking) return undefined;
    const payload = JSON.parse(booking.payload);
    const profile = db.prepare("SELECT * FROM event_profiles WHERE booking_id=?").get(bookingId) as Row | undefined;
    const participants = db.prepare(`
      SELECT id,name,email,phone,guardian_name AS guardianName,guardian_phone AS guardianPhone,
             waiver_signed AS waiverSigned,checked_in AS checkedIn,team_index AS teamIndex,
             active,created_at AS createdAt,updated_at AS updatedAt
      FROM participants WHERE booking_id=? ORDER BY active DESC,team_index,created_at,id
    `).all(bookingId) as Row[];
    const active = participants.filter((item) => item.active);
    const sizes = balancedRosterSizes(active.length);
    return {
      bookingId,
      reference: booking.reference,
      status: booking.status,
      date: booking.date,
      time: booking.time,
      mission: payload.mission?.name ?? "",
      expectedPlayers: payload.draft?.players ?? 0,
      expectedTeamSizes: payload.summary?.teamSizes ?? [],
      profile: profile ? {
        eventName: profile.event_name,
        organization: profile.organization,
        groupType: profile.group_type,
        ageGroup: profile.age_group,
        objectives: profile.objectives,
        accessibilityNotes: profile.accessibility_notes,
        emergencyContactName: profile.emergency_contact_name,
        emergencyContactPhone: profile.emergency_contact_phone,
        photoConsent: Boolean(profile.photo_consent),
        rosterLocked: Boolean(profile.roster_locked),
        eventStatus: profile.event_status,
        updatedAt: profile.updated_at,
      } : null,
      participants: participants.map((item) => ({
        ...item,
        waiverSigned: Boolean(item.waiverSigned),
        checkedIn: Boolean(item.checkedIn),
        active: Boolean(item.active),
        ...(includePrivate ? {} : { email: item.email, phone: item.phone }),
      })),
      registeredPlayers: active.length,
      rosterTeamSizes: sizes,
    };
  }

  function installRoutes(app: Express, helpers: Helpers) {
    const { fail, text, getBooking } = helpers;
    const portal = (req: Request, _res: Response, next: NextFunction) => {
      const booking = portalBooking(String(req.params.token ?? ""));
      if (!booking) return next(Object.assign(new Error("Registration link is invalid or expired."), { status: 404 }));
      (req as any).portalBooking = booking;
      next();
    };
    const ensureUnlocked = (bookingId: string) => {
      const profile = db.prepare("SELECT roster_locked FROM event_profiles WHERE booking_id=?").get(bookingId) as Row | undefined;
      if (profile?.roster_locked) fail(409, "Teams are locked. Contact CombatZone to make roster changes.");
    };

    app.get("/api/portal/:token", portal, (req, res) => {
      const booking = (req as any).portalBooking as Row;
      res.json(eventData(booking.id));
    });

    app.put("/api/portal/:token/profile", portal, (req, res) => {
      const booking = (req as any).portalBooking as Row;
      const groupTypes = ["birthday","corporate","school","community","resort","friends","other"];
      const ageGroups = ["children","teens","adults","mixed"];
      if (!groupTypes.includes(req.body.groupType) || !ageGroups.includes(req.body.ageGroup))
        fail(400, "Choose a valid group type and age group.");
      const profile = {
        eventName: text(req.body.eventName ?? "", "event name", 120),
        organization: text(req.body.organization ?? "", "organization", 120),
        groupType: req.body.groupType,
        ageGroup: req.body.ageGroup,
        objectives: text(req.body.objectives ?? "", "event objectives", 1000),
        accessibilityNotes: text(req.body.accessibilityNotes ?? "", "accessibility notes", 1000),
        emergencyContactName: text(req.body.emergencyContactName, "emergency contact name", 120, 2),
        emergencyContactPhone: text(req.body.emergencyContactPhone, "emergency contact phone", 30, 7),
        photoConsent: Boolean(req.body.photoConsent),
      };
      db.prepare(`
        UPDATE event_profiles SET event_name=?,organization=?,group_type=?,age_group=?,objectives=?,
          accessibility_notes=?,emergency_contact_name=?,emergency_contact_phone=?,photo_consent=?,updated_at=?
        WHERE booking_id=?
      `).run(
        profile.eventName,profile.organization,profile.groupType,profile.ageGroup,profile.objectives,
        profile.accessibilityNotes,profile.emergencyContactName,profile.emergencyContactPhone,
        profile.photoConsent ? 1 : 0,now(),booking.id
      );
      res.json(eventData(booking.id));
    });

    app.post("/api/portal/:token/participants", portal, (req, res) => {
      const booking = (req as any).portalBooking as Row;
      ensureUnlocked(booking.id);
      const count = (db.prepare("SELECT COUNT(*) AS n FROM participants WHERE booking_id=? AND active=1").get(booking.id) as Row).n;
      if (count >= 60) fail(400, "Roster limit reached.");
      const name = text(req.body.name, "participant name", 120, 2);
      const stamp = now();
      db.prepare(`
        INSERT INTO participants(id,booking_id,name,email,phone,guardian_name,guardian_phone,waiver_signed,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
      `).run(
        randomUUID(),booking.id,name,safeText(req.body.email,254),safeText(req.body.phone,30),
        safeText(req.body.guardianName,120),safeText(req.body.guardianPhone,30),
        req.body.waiverSigned ? 1 : 0,stamp,stamp
      );
      rebalance(booking.id);
      res.status(201).json(eventData(booking.id));
    });

    app.patch("/api/portal/:token/participants/:participantId", portal, (req, res) => {
      const booking = (req as any).portalBooking as Row;
      ensureUnlocked(booking.id);
      const participant = db.prepare("SELECT * FROM participants WHERE id=? AND booking_id=?")
        .get(String(req.params.participantId), booking.id) as Row | undefined;
      if (!participant) fail(404, "Participant not found.");
      const p = participant as Row;
      const name = req.body.name === undefined ? p.name : text(req.body.name, "participant name", 120, 2);
      db.prepare(`
        UPDATE participants SET name=?,email=?,phone=?,guardian_name=?,guardian_phone=?,waiver_signed=?,updated_at=?
        WHERE id=? AND booking_id=?
      `).run(
        name,
        req.body.email === undefined ? p.email : safeText(req.body.email,254),
        req.body.phone === undefined ? p.phone : safeText(req.body.phone,30),
        req.body.guardianName === undefined ? p.guardian_name : safeText(req.body.guardianName,120),
        req.body.guardianPhone === undefined ? p.guardian_phone : safeText(req.body.guardianPhone,30),
        req.body.waiverSigned === undefined ? p.waiver_signed : (req.body.waiverSigned ? 1 : 0),
        now(),p.id,booking.id
      );
      res.json(eventData(booking.id));
    });

    app.delete("/api/portal/:token/participants/:participantId", portal, (req, res) => {
      const booking = (req as any).portalBooking as Row;
      ensureUnlocked(booking.id);
      const result = db.prepare("DELETE FROM participants WHERE id=? AND booking_id=?")
        .run(String(req.params.participantId), booking.id);
      if (!result.changes) fail(404, "Participant not found.");
      rebalance(booking.id);
      res.json(eventData(booking.id));
    });

    app.get("/api/admin/events/:bookingId", (req, res) => {
      getBooking(String(req.params.bookingId));
      res.json(eventData(String(req.params.bookingId), true));
    });

    app.post("/api/admin/events/:bookingId/rebalance", (req, res) => {
      const bookingId = String(req.params.bookingId);
      getBooking(bookingId);
      rebalance(bookingId, Boolean(req.body.randomize));
      res.json(eventData(bookingId, true));
    });

    app.post("/api/admin/events/:bookingId/lock", (req, res) => {
      const bookingId = String(req.params.bookingId);
      getBooking(bookingId);
      if (typeof req.body.locked !== "boolean") fail(400, "Choose whether teams are locked.");
      db.prepare("UPDATE event_profiles SET roster_locked=?,updated_at=? WHERE booking_id=?")
        .run(req.body.locked ? 1 : 0, now(), bookingId);
      res.json(eventData(bookingId, true));
    });

    app.patch("/api/admin/events/:bookingId/participants/:participantId", (req, res) => {
      const bookingId = String(req.params.bookingId);
      getBooking(bookingId);
      const participant = db.prepare("SELECT * FROM participants WHERE id=? AND booking_id=?")
        .get(String(req.params.participantId), bookingId) as Row | undefined;
      if (!participant) fail(404, "Participant not found.");
      const p = participant as Row;
      const teamIndex = req.body.teamIndex === undefined ? p.team_index : Number(req.body.teamIndex);
      if (!Number.isInteger(teamIndex) || teamIndex < -1 || teamIndex > 20) fail(400, "Invalid team assignment.");
      db.prepare(`
        UPDATE participants SET team_index=?,checked_in=?,waiver_signed=?,active=?,updated_at=?
        WHERE id=? AND booking_id=?
      `).run(
        teamIndex,
        req.body.checkedIn === undefined ? p.checked_in : (req.body.checkedIn ? 1 : 0),
        req.body.waiverSigned === undefined ? p.waiver_signed : (req.body.waiverSigned ? 1 : 0),
        req.body.active === undefined ? p.active : (req.body.active ? 1 : 0),
        now(),p.id,bookingId
      );
      res.json(eventData(bookingId, true));
    });
  }

  return {
    createBookingPortal,
    rotatePortalToken: newPortalToken,
    installRoutes,
    eventData,
    publicOrigin,
  };
}
