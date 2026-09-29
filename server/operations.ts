import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
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
      token_value TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS equipment(
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'available',
      battery INTEGER NOT NULL DEFAULT 100,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_rounds(
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      round_no INTEGER NOT NULL,
      team_a INTEGER NOT NULL,
      team_b INTEGER NOT NULL,
      mode TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT NOT NULL DEFAULT '',
      elapsed_seconds INTEGER NOT NULL DEFAULT 0,
      ended_at TEXT NOT NULL DEFAULT '',
      score_a INTEGER NOT NULL DEFAULT 0,
      score_b INTEGER NOT NULL DEFAULT 0,
      objective_a INTEGER NOT NULL DEFAULT 0,
      objective_b INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(booking_id,round_no)
    );
    CREATE INDEX IF NOT EXISTS rounds_booking ON event_rounds(booking_id,round_no);
    CREATE TABLE IF NOT EXISTS event_incidents(
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      note TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS participant_invites(
      booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      token_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_feedback(
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_media(
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(booking_id,media_id)
    );
    CREATE TABLE IF NOT EXISTS communications(
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(booking_id,type)
    );
  `);
  const participantColumns = db.prepare("PRAGMA table_info(participants)").all() as Row[];
  if (!participantColumns.some((column) => column.name === "equipment_code")) {
    db.exec("ALTER TABLE participants ADD COLUMN equipment_code TEXT NOT NULL DEFAULT ''");
  }
  if (!participantColumns.some((column) => column.name === "checkin_hash")) {
    db.exec("ALTER TABLE participants ADD COLUMN checkin_hash TEXT NOT NULL DEFAULT ''");
  }
  if (!participantColumns.some((column) => column.name === "checkin_value")) {
    db.exec("ALTER TABLE participants ADD COLUMN checkin_value TEXT NOT NULL DEFAULT ''");
  }
  const portalColumns = db.prepare("PRAGMA table_info(booking_portals)").all() as Row[];
  if (!portalColumns.some((column) => column.name === "token_value")) {
    db.exec("ALTER TABLE booking_portals ADD COLUMN token_value TEXT NOT NULL DEFAULT ''");
  }
  const equipmentStamp = now();
  for (let number = 1; number <= 12; number += 1) {
    const code = `FALCON-${String(number).padStart(2, "0")}`;
    db.prepare("INSERT OR IGNORE INTO equipment(code,status,battery,notes,updated_at) VALUES(?,?,?,?,?)")
      .run(code,"available",100,"",equipmentStamp);
  }

  function newPortalToken(bookingId: string) {
    const token = randomBytes(32).toString("hex");
    const stamp = now();
    db.prepare(`
      INSERT INTO booking_portals(booking_id,token_hash,token_value,created_at,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(booking_id) DO UPDATE SET token_hash=excluded.token_hash,token_value=excluded.token_value,updated_at=excluded.updated_at
    `).run(bookingId, digest(token), token, stamp, stamp);
    return token;
  }

  function newInviteToken(bookingId: string) {
    const existing = db.prepare("SELECT token_value FROM participant_invites WHERE booking_id=?").get(bookingId) as Row | undefined;
    if (existing?.token_value) return String(existing.token_value);
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO participant_invites(booking_id,token_hash,token_value,created_at) VALUES(?,?,?,?)")
      .run(bookingId,digest(token),token,now());
    return token;
  }

  function newCheckinToken() {
    const token = randomBytes(24).toString("hex");
    return { token, hash: digest(token) };
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
    const inviteToken = newInviteToken(bookingId);
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
      const checkin = newCheckinToken();
      db.prepare(`
        INSERT INTO participants(id,booking_id,name,checkin_hash,checkin_value,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)
      `).run(randomUUID(), bookingId, name.slice(0, 120), checkin.hash, checkin.token, stamp, stamp);
    }
    if (names.length) rebalance(bookingId);
    return { token, inviteToken, expectedTeams: summary.teamSizes };
  }

  function portalBooking(rawToken: string) {
    if (!tokenPattern.test(rawToken)) return undefined;
    return db.prepare(`
      SELECT b.* FROM booking_portals p
      JOIN bookings b ON b.id=p.booking_id
      WHERE p.token_hash=?
    `).get(digest(rawToken)) as Row | undefined;
  }

  function inviteBooking(rawToken: string) {
    if (!tokenPattern.test(rawToken)) return undefined;
    return db.prepare(`
      SELECT b.* FROM participant_invites i
      JOIN bookings b ON b.id=i.booking_id
      WHERE i.token_hash=?
    `).get(digest(rawToken)) as Row | undefined;
  }

  function checkinParticipant(rawToken: string) {
    if (!/^[a-f0-9]{48}$/i.test(rawToken)) return undefined;
    return db.prepare(`
      SELECT p.*,b.reference,b.date,b.time,b.payload
      FROM participants p JOIN bookings b ON b.id=p.booking_id
      WHERE p.checkin_hash=? AND p.active=1
    `).get(digest(rawToken)) as Row | undefined;
  }

  function leaderboard(bookingId: string) {
    const rounds = db.prepare(
      "SELECT team_a,team_b,score_a,score_b,objective_a,objective_b,status FROM event_rounds WHERE booking_id=? AND status='completed'"
    ).all(bookingId) as Row[];
    const table = new Map<number, { teamIndex:number; played:number; wins:number; draws:number; losses:number; points:number; scored:number; conceded:number; objectives:number }>();
    const ensure = (teamIndex: number) => {
      if (!table.has(teamIndex)) table.set(teamIndex,{teamIndex,played:0,wins:0,draws:0,losses:0,points:0,scored:0,conceded:0,objectives:0});
      return table.get(teamIndex)!;
    };
    for (const round of rounds) {
      if (round.team_a < 0 || round.team_b < 0) continue;
      const a=ensure(round.team_a), b=ensure(round.team_b);
      a.played++; b.played++;
      a.scored += round.score_a; a.conceded += round.score_b; a.objectives += round.objective_a;
      b.scored += round.score_b; b.conceded += round.score_a; b.objectives += round.objective_b;
      if (round.score_a > round.score_b) { a.wins++; b.losses++; a.points += 3; }
      else if (round.score_b > round.score_a) { b.wins++; a.losses++; b.points += 3; }
      else { a.draws++; b.draws++; a.points++; b.points++; }
    }
    return [...table.values()].sort((a,b) =>
      b.points-a.points || (b.scored-b.conceded)-(a.scored-a.conceded) || b.objectives-a.objectives || a.teamIndex-b.teamIndex
    );
  }

  function roundData(bookingId: string) {
    const stamp = Date.now();
    return (db.prepare("SELECT * FROM event_rounds WHERE booking_id=? ORDER BY round_no").all(bookingId) as Row[]).map((row) => {
      const liveExtra = row.status === "live" && row.started_at ? Math.max(0, Math.floor((stamp - Date.parse(row.started_at))/1000)) : 0;
      return {
        id: row.id, roundNo: row.round_no, teamA: row.team_a, teamB: row.team_b,
        mode: row.mode, durationSeconds: row.duration_seconds, status: row.status,
        startedAt: row.started_at, elapsedSeconds: row.elapsed_seconds + liveExtra,
        endedAt: row.ended_at, scoreA: row.score_a, scoreB: row.score_b,
        objectiveA: row.objective_a, objectiveB: row.objective_b, notes: row.notes,
      };
    });
  }

  function eventData(bookingId: string, includePrivate = false) {
    const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId) as Row | undefined;
    if (!booking) return undefined;
    const payload = JSON.parse(booking.payload);
    const profile = db.prepare("SELECT * FROM event_profiles WHERE booking_id=?").get(bookingId) as Row | undefined;
    const participants = db.prepare(`
      SELECT id,name,email,phone,guardian_name AS guardianName,guardian_phone AS guardianPhone,
             waiver_signed AS waiverSigned,checked_in AS checkedIn,team_index AS teamIndex,
             equipment_code AS equipmentCode,checkin_value AS checkinValue,active,created_at AS createdAt,updated_at AS updatedAt
      FROM participants WHERE booking_id=? ORDER BY active DESC,team_index,created_at,id
    `).all(bookingId) as Row[];
    const active = participants.filter((item) => item.active);
    const sizes = balancedRosterSizes(active.length);
    const invite = db.prepare("SELECT token_value FROM participant_invites WHERE booking_id=?").get(bookingId) as Row | undefined;
    const portalRecord = includePrivate
      ? db.prepare("SELECT token_value FROM booking_portals WHERE booking_id=?").get(bookingId) as Row | undefined
      : undefined;
    const gallery = db.prepare(`
      SELECT em.media_id AS id,em.label,m.name,m.mime
      FROM event_media em JOIN media m ON m.id=em.media_id
      WHERE em.booking_id=? AND m.public=1 ORDER BY em.label,m.created_at
    `).all(bookingId) as Row[];
    return {
      serverNow: now(),
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
        id:item.id,name:item.name,email:item.email,phone:item.phone,
        guardianName:item.guardianName,guardianPhone:item.guardianPhone,
        waiverSigned:Boolean(item.waiverSigned),checkedIn:Boolean(item.checkedIn),
        teamIndex:item.teamIndex,equipmentCode:includePrivate ? item.equipmentCode : "",
        active:Boolean(item.active),createdAt:item.createdAt,updatedAt:item.updatedAt,
        checkInUrl:item.checkinValue ? `${publicOrigin}/checkin/${item.checkinValue}` : "",
      })),
      registeredPlayers: active.length,
      rosterTeamSizes: sizes,
      joinUrl: invite?.token_value ? `${publicOrigin}/join/${invite.token_value}` : "",
      registrationUrl: portalRecord?.token_value ? `${publicOrigin}/manage/${portalRecord.token_value}` : "",
      rounds: roundData(bookingId),
      leaderboard: leaderboard(bookingId),
      gallery: gallery.map((item)=>({id:item.id,label:item.label,name:item.name,mime:item.mime,url:`/uploads/${item.id}`})),
      equipment: includePrivate ? db.prepare("SELECT code,status,battery,notes,updated_at AS updatedAt FROM equipment ORDER BY code").all() : [],
      incidents: includePrivate ? db.prepare("SELECT id,at,kind,note,resolved,resolved_at AS resolvedAt FROM event_incidents WHERE booking_id=? ORDER BY at DESC").all(bookingId)
        .map((item: Row) => ({...item,resolved:Boolean(item.resolved)})) : [],
      feedback: includePrivate
        ? db.prepare("SELECT id,rating,comment,created_at AS createdAt FROM event_feedback WHERE booking_id=? ORDER BY created_at DESC").all(bookingId)
        : db.prepare("SELECT rating,comment,created_at AS createdAt FROM event_feedback WHERE booking_id=? ORDER BY created_at DESC LIMIT 1").all(bookingId),
      communications: includePrivate
        ? db.prepare("SELECT type,sent_at AS sentAt,status,detail FROM communications WHERE booking_id=? ORDER BY sent_at DESC").all(bookingId)
        : [],
    };
  }

  const mailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
  const mailer = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    requireTLS: process.env.SMTP_PORT !== "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });

  async function sendEventMessage(
    bookingId: string,
    type: "confirmation" | "reminder_7d" | "reminder_1d" | "results",
    portalTokenOverride?: string,
  ) {
    if (!mailConfigured()) return { sent: false, detail: "SMTP not configured." };
    const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId) as Row | undefined;
    if (!booking) return { sent: false, detail: "Booking not found." };
    const payload = JSON.parse(booking.payload);
    const profile = db.prepare("SELECT event_name,organization,event_status FROM event_profiles WHERE booking_id=?")
      .get(bookingId) as Row | undefined;
    const portal = db.prepare("SELECT token_value FROM booking_portals WHERE booking_id=?").get(bookingId) as Row | undefined;
    const token = portalTokenOverride || String(portal?.token_value || "");
    const registrationUrl = token ? `${publicOrigin}/manage/${token}` : publicOrigin;
    const join = db.prepare("SELECT token_value FROM participant_invites WHERE booking_id=?").get(bookingId) as Row | undefined;
    const joinUrl = join?.token_value ? `${publicOrigin}/join/${join.token_value}` : "";
    const eventName = profile?.event_name || payload.mission?.name || "CombatZone mission";
    const dates = `${booking.date} at ${booking.time} AST`;
    const messages = {
      confirmation: {
        subject: `CombatZone registration received — ${booking.reference}`,
        body: `Hi ${payload.draft.customer.fullName},\n\nYour ${eventName} request has been received for ${dates}. Your booking is still pending confirmation.\n\nComplete the event roster and preparation here:\n${registrationUrl}\n\nParticipant self-registration link:\n${joinUrl}\n\nReference: ${booking.reference}\n\nCombatZone SLU`,
      },
      reminder_7d: {
        subject: `CombatZone mission next week — ${booking.reference}`,
        body: `Your ${eventName} is scheduled for ${dates}. Please review the roster, waivers, emergency contact and venue information before event day:\n${registrationUrl}\n\nReference: ${booking.reference}\n\nCombatZone SLU`,
      },
      reminder_1d: {
        subject: `CombatZone mission tomorrow — ${booking.reference}`,
        body: `Your ${eventName} is scheduled for ${dates}. Please ensure the participant roster and safety acknowledgements are complete.\n\nEvent registration:\n${registrationUrl}\n\nReference: ${booking.reference}\n\nCombatZone SLU`,
      },
      results: {
        subject: `CombatZone results — ${booking.reference}`,
        body: `Thanks for playing ${eventName}. Your results, event gallery and feedback form are available here:\n${registrationUrl}\n\nWe hope to see your team back in the CombatZone.\n\nCombatZone SLU`,
      },
    } as const;
    const message = messages[type];
    try {
      await mailer().sendMail({
        from: process.env.SMTP_FROM,
        to: payload.draft.customer.email,
        subject: message.subject,
        text: message.body,
      });
      db.prepare(`
        INSERT INTO communications(booking_id,type,sent_at,status,detail)
        VALUES(?,?,?,?,?)
        ON CONFLICT(booking_id,type) DO UPDATE SET sent_at=excluded.sent_at,status=excluded.status,detail=excluded.detail
      `).run(bookingId,type,now(),"sent","");
      return { sent: true, detail: "" };
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0,500) : "Email delivery failed.";
      db.prepare(`
        INSERT INTO communications(booking_id,type,sent_at,status,detail)
        VALUES(?,?,?,?,?)
        ON CONFLICT(booking_id,type) DO UPDATE SET sent_at=excluded.sent_at,status=excluded.status,detail=excluded.detail
      `).run(bookingId,type,now(),"failed",detail);
      return { sent: false, detail };
    }
  }

  const reminderTick = async () => {
    if (!mailConfigured()) return;
    const current = Date.now();
    const windows = [
      { type: "reminder_7d" as const, from: current + 6.5*86400000, to: current + 7.5*86400000 },
      { type: "reminder_1d" as const, from: current + 20*3600000, to: current + 28*3600000 },
    ];
    for (const window of windows) {
      const rows = db.prepare(`
        SELECT id FROM bookings b
        WHERE status='confirmed' AND start_ms BETWEEN ? AND ?
          AND NOT EXISTS(SELECT 1 FROM communications c WHERE c.booking_id=b.id AND c.type=? AND c.status='sent')
      `).all(window.from,window.to,window.type) as Row[];
      for (const row of rows) await sendEventMessage(row.id,window.type);
    }
  };
  if (mailConfigured() && process.env.NODE_ENV !== "test") {
    const timer = setInterval(() => { void reminderTick(); }, 60*60*1000);
    timer.unref();
    const initial = setTimeout(() => { void reminderTick(); }, 5000);
    initial.unref();
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
    const invite = (req: Request, _res: Response, next: NextFunction) => {
      const booking = inviteBooking(String(req.params.token ?? ""));
      if (!booking) return next(Object.assign(new Error("Participant registration link is invalid or expired."), { status: 404 }));
      (req as any).inviteBooking = booking;
      next();
    };
    const checkin = (req: Request, _res: Response, next: NextFunction) => {
      const participant = checkinParticipant(String(req.params.token ?? ""));
      if (!participant) return next(Object.assign(new Error("Check-in link is invalid or expired."), { status: 404 }));
      (req as any).checkinParticipant = participant;
      next();
    };

    app.get("/api/join/:token", invite, (req,res) => {
      const booking=(req as any).inviteBooking as Row;
      const payload=JSON.parse(booking.payload);
      const profile=db.prepare("SELECT event_name,organization,age_group,roster_locked,event_status FROM event_profiles WHERE booking_id=?").get(booking.id) as Row;
      const registered=(db.prepare("SELECT COUNT(*) AS n FROM participants WHERE booking_id=? AND active=1").get(booking.id) as Row).n;
      res.json({
        reference:booking.reference,date:booking.date,time:booking.time,
        mission:payload.mission?.name ?? "",expectedPlayers:payload.draft?.players ?? 0,
        registeredPlayers:registered,eventName:profile?.event_name ?? "",
        organization:profile?.organization ?? "",ageGroup:profile?.age_group ?? "mixed",
        rosterLocked:Boolean(profile?.roster_locked),eventStatus:profile?.event_status ?? "registration",
      });
    });

    app.get("/api/join/:token/qr", invite, async (req,res,next) => {
      try {
        const url=`${publicOrigin}/join/${String(req.params.token)}`;
        const svg=await QRCode.toString(url,{type:"svg",margin:1,width:320,errorCorrectionLevel:"M"});
        res.type("image/svg+xml").set("Cache-Control","private, no-store").send(svg);
      } catch(error){ next(error); }
    });

    app.post("/api/join/:token", invite, (req,res) => {
      const booking=(req as any).inviteBooking as Row;
      ensureUnlocked(booking.id);
      const count=(db.prepare("SELECT COUNT(*) AS n FROM participants WHERE booking_id=? AND active=1").get(booking.id) as Row).n;
      if(count>=60) fail(400,"Roster limit reached.");
      const name=text(req.body.name,"participant name",120,2);
      const checkinToken=newCheckinToken();
      const stamp=now();
      const id=randomUUID();
      db.prepare(`
        INSERT INTO participants(id,booking_id,name,email,phone,guardian_name,guardian_phone,waiver_signed,checkin_hash,checkin_value,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id,booking.id,name,safeText(req.body.email,254),safeText(req.body.phone,30),
        safeText(req.body.guardianName,120),safeText(req.body.guardianPhone,30),
        req.body.waiverSigned?1:0,checkinToken.hash,checkinToken.token,stamp,stamp
      );
      rebalance(booking.id);
      const participant=db.prepare("SELECT team_index FROM participants WHERE id=?").get(id) as Row;
      res.status(201).json({
        ok:true,participantId:id,name,teamIndex:participant.team_index,
        checkInUrl:`${publicOrigin}/checkin/${checkinToken.token}`,
      });
    });

    app.get("/api/checkin/:token", checkin, (req,res) => {
      const participant=(req as any).checkinParticipant as Row;
      const payload=JSON.parse(participant.payload);
      res.json({
        participantId:participant.id,name:participant.name,reference:participant.reference,
        date:participant.date,time:participant.time,mission:payload.mission?.name ?? "",
        checkedIn:Boolean(participant.checked_in),waiverSigned:Boolean(participant.waiver_signed),
        teamIndex:participant.team_index,
      });
    });

    app.get("/api/checkin/:token/qr", checkin, async (req,res,next) => {
      try {
        const url=`${publicOrigin}/checkin/${String(req.params.token)}`;
        const svg=await QRCode.toString(url,{type:"svg",margin:1,width:320,errorCorrectionLevel:"M"});
        res.type("image/svg+xml").set("Cache-Control","private, no-store").send(svg);
      } catch(error){ next(error); }
    });

    app.post("/api/checkin/:token", checkin, (req,res) => {
      const participant=(req as any).checkinParticipant as Row;
      db.prepare("UPDATE participants SET checked_in=1,waiver_signed=?,updated_at=? WHERE id=?")
        .run(req.body.waiverSigned===false ? participant.waiver_signed : 1,now(),participant.id);
      res.json({ok:true,checkedIn:true});
    });

    app.get("/api/portal/:token", portal, (req, res) => {
      const booking = (req as any).portalBooking as Row;
      res.json(eventData(booking.id));
    });

    app.get("/api/portal/:token/join-qr", portal, async (req, res, next) => {
      try {
        const booking = (req as any).portalBooking as Row;
        const data = eventData(booking.id);
        if (!data?.joinUrl) fail(404, "Participant registration link is unavailable.");
        const svg = await QRCode.toString(data.joinUrl, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 1,
          width: 320,
        });
        res.set({ "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" }).send(svg);
      } catch (error) { next(error); }
    });

    app.get("/api/join/:token", (req, res) => {
      const booking = inviteBooking(String(req.params.token ?? ""));
      if (!booking) fail(404, "Participant registration link is invalid or expired.");
      const data = eventData(booking.id);
      const profile = data?.profile;
      res.json({
        reference: booking.reference,
        date: booking.date,
        time: booking.time,
        mission: data?.mission ?? "",
        eventName: profile?.eventName ?? "",
        organization: profile?.organization ?? "",
        ageGroup: profile?.ageGroup ?? "mixed",
        expectedPlayers: data?.expectedPlayers ?? 0,
        registeredPlayers: data?.registeredPlayers ?? 0,
        rosterLocked: Boolean(profile?.rosterLocked),
      });
    });

    app.post("/api/join/:token", (req, res) => {
      const booking = inviteBooking(String(req.params.token ?? ""));
      if (!booking) fail(404, "Participant registration link is invalid or expired.");
      ensureUnlocked(booking.id);
      const payload = JSON.parse(booking.payload);
      const expected = Math.min(60, Number(payload.draft?.players ?? 0));
      const count = (db.prepare("SELECT COUNT(*) AS n FROM participants WHERE booking_id=? AND active=1").get(booking.id) as Row).n;
      if (expected && count >= expected) fail(409, "This event roster is full. Contact the organizer if the booking size changes.");
      const stamp = now();
      const checkin = newCheckinToken();
      const participantId = randomUUID();
      db.prepare(`
        INSERT INTO participants(
          id,booking_id,name,email,phone,guardian_name,guardian_phone,
          waiver_signed,checkin_hash,checkin_value,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        participantId,
        booking.id,
        text(req.body.name, "participant name", 120, 2),
        safeText(req.body.email,254),
        safeText(req.body.phone,30),
        safeText(req.body.guardianName,120),
        safeText(req.body.guardianPhone,30),
        req.body.safetyAcknowledged ? 1 : 0,
        checkin.hash,
        checkin.token,
        stamp,
        stamp,
      );
      rebalance(booking.id);
      res.status(201).json({
        registered: true,
        participantId,
        checkInUrl: `${publicOrigin}/checkin/${checkin.token}`,
        event: eventData(booking.id),
      });
    });

    app.get("/api/checkin/:token", (req, res) => {
      const participant = checkinParticipant(String(req.params.token ?? ""));
      if (!participant) fail(404, "Check-in link is invalid or expired.");
      const payload = JSON.parse(participant.payload);
      const profile = db.prepare("SELECT event_name,organization,age_group,event_status FROM event_profiles WHERE booking_id=?").get(participant.booking_id) as Row | undefined;
      res.json({
        name: participant.name,
        reference: participant.reference,
        date: participant.date,
        time: participant.time,
        mission: payload.mission?.name ?? "",
        eventName: profile?.event_name ?? "",
        organization: profile?.organization ?? "",
        ageGroup: profile?.age_group ?? "mixed",
        eventStatus: profile?.event_status ?? "registration",
        teamIndex: participant.team_index,
        checkedIn: Boolean(participant.checked_in),
        safetyAcknowledged: Boolean(participant.waiver_signed),
        guardianName: participant.guardian_name,
        guardianPhone: participant.guardian_phone,
      });
    });

    app.get("/api/checkin/:token/qr", async (req, res, next) => {
      try {
        const rawToken = String(req.params.token ?? "");
        const participant = checkinParticipant(rawToken);
        if (!participant) fail(404, "Check-in link is invalid or expired.");
        const svg = await QRCode.toString(`${publicOrigin}/checkin/${rawToken}`, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 1,
          width: 320,
        });
        res.set({ "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" }).send(svg);
      } catch (error) { next(error); }
    });

    app.post("/api/checkin/:token", (req, res) => {
      const participant = checkinParticipant(String(req.params.token ?? ""));
      if (!participant) fail(404, "Check-in link is invalid or expired.");
      if (req.body.safetyAcknowledged !== true)
        fail(400, "Safety acknowledgement is required before check-in.");
      const profile = db.prepare("SELECT age_group,roster_locked FROM event_profiles WHERE booking_id=?").get(participant.booking_id) as Row | undefined;
      const minorGroup = ["children","teens"].includes(String(profile?.age_group ?? ""));
      const guardianName = req.body.guardianName === undefined
        ? participant.guardian_name
        : safeText(req.body.guardianName,120);
      const guardianPhone = req.body.guardianPhone === undefined
        ? participant.guardian_phone
        : safeText(req.body.guardianPhone,30);
      if (minorGroup && (!guardianName || guardianPhone.replace(/\D/g,"").length < 7))
        fail(400, "Parent or guardian details are required for youth check-in.");
      db.prepare(`
        UPDATE participants SET waiver_signed=1,checked_in=1,guardian_name=?,guardian_phone=?,updated_at=?
        WHERE id=?
      `).run(guardianName,guardianPhone,now(),participant.id);
      res.json({ checkedIn: true });
    });

    app.post("/api/portal/:token/feedback", portal, (req, res) => {
      const booking = (req as any).portalBooking as Row;
      const profile = db.prepare("SELECT event_status FROM event_profiles WHERE booking_id=?").get(booking.id) as Row | undefined;
      if (profile?.event_status !== "complete" && booking.status !== "completed")
        fail(409, "Feedback opens after the event is completed.");
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, "Choose a rating from 1 to 5.");
      const comment = text(req.body.comment ?? "", "feedback comment", 1500);
      db.prepare("INSERT INTO event_feedback(id,booking_id,rating,comment,created_at) VALUES(?,?,?,?,?)")
        .run(randomUUID(),booking.id,rating,comment,now());
      res.status(201).json({ ok: true });
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
      const checkin = newCheckinToken();
      db.prepare(`
        INSERT INTO participants(id,booking_id,name,email,phone,guardian_name,guardian_phone,waiver_signed,checkin_hash,checkin_value,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        randomUUID(),booking.id,name,safeText(req.body.email,254),safeText(req.body.phone,30),
        safeText(req.body.guardianName,120),safeText(req.body.guardianPhone,30),
        req.body.waiverSigned ? 1 : 0,checkin.hash,checkin.token,stamp,stamp
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

    app.post("/api/portal/:token/feedback", portal, (req,res) => {
      const booking=(req as any).portalBooking as Row;
      const profile=db.prepare("SELECT event_status FROM event_profiles WHERE booking_id=?").get(booking.id) as Row | undefined;
      if(profile?.event_status!=="complete") fail(409,"Feedback opens after the event is completed.");
      const rating=Number(req.body.rating);
      if(!Number.isInteger(rating) || rating<1 || rating>5) fail(400,"Choose a rating from 1 to 5.");
      const comment=text(req.body.comment ?? "","feedback",2000);
      db.prepare("DELETE FROM event_feedback WHERE booking_id=?").run(booking.id);
      db.prepare("INSERT INTO event_feedback(id,booking_id,rating,comment,created_at) VALUES(?,?,?,?,?)")
        .run(randomUUID(),booking.id,rating,comment,now());
      res.status(201).json({ok:true});
    });

    app.get("/api/admin/events/:bookingId", (req, res) => {
      getBooking(String(req.params.bookingId));
      res.json(eventData(String(req.params.bookingId), true));
    });

    app.post("/api/admin/events/:bookingId/media", (req,res) => {
      const bookingId=String(req.params.bookingId);
      getBooking(bookingId);
      const mediaId=text(req.body.mediaId,"media",120,2);
      if(!db.prepare("SELECT id FROM media WHERE id=?").get(mediaId)) fail(400,"Choose valid media.");
      const label=text(req.body.label ?? "Event photo","gallery label",120);
      db.prepare("INSERT INTO event_media(booking_id,media_id,label) VALUES(?,?,?) ON CONFLICT(booking_id,media_id) DO UPDATE SET label=excluded.label")
        .run(bookingId,mediaId,label);
      db.prepare("UPDATE media SET public=1 WHERE id=?").run(mediaId);
      res.json(eventData(bookingId,true));
    });

    app.delete("/api/admin/events/:bookingId/media/:mediaId", (req,res) => {
      const bookingId=String(req.params.bookingId);
      getBooking(bookingId);
      db.prepare("DELETE FROM event_media WHERE booking_id=? AND media_id=?").run(bookingId,String(req.params.mediaId));
      res.json(eventData(bookingId,true));
    });

    app.post("/api/admin/events/:bookingId/communications", async (req,res) => {
      const bookingId=String(req.params.bookingId);
      getBooking(bookingId);
      const allowed=["confirmation","reminder_7d","reminder_1d","results"] as const;
      if(!allowed.includes(req.body.type)) fail(400,"Choose a valid message type.");
      const result=await sendEventMessage(bookingId,req.body.type);
      res.status(result.sent ? 200 : 503).json({ ...result, event:eventData(bookingId,true) });
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
      let equipmentCode = req.body.equipmentCode === undefined ? p.equipment_code : safeText(req.body.equipmentCode,32);
      if (equipmentCode) {
        const gear = db.prepare("SELECT code,status FROM equipment WHERE code=?").get(equipmentCode) as Row | undefined;
        if (!gear || gear.status === "maintenance" || gear.status === "damaged") fail(400, "Selected equipment is not available.");
        const occupied = db.prepare("SELECT id FROM participants WHERE booking_id=? AND equipment_code=? AND active=1 AND id<>?")
          .get(bookingId,equipmentCode,p.id) as Row | undefined;
        if (occupied) fail(409, "That tagger is already assigned to another active participant.");
      }
      db.prepare(`
        UPDATE participants SET team_index=?,checked_in=?,waiver_signed=?,active=?,equipment_code=?,updated_at=?
        WHERE id=? AND booking_id=?
      `).run(
        teamIndex,
        req.body.checkedIn === undefined ? p.checked_in : (req.body.checkedIn ? 1 : 0),
        req.body.waiverSigned === undefined ? p.waiver_signed : (req.body.waiverSigned ? 1 : 0),
        req.body.active === undefined ? p.active : (req.body.active ? 1 : 0),
        equipmentCode,
        now(),p.id,bookingId
      );
      res.json(eventData(bookingId, true));
    });

    app.post("/api/admin/events/:bookingId/equipment/auto-assign", (req, res) => {
      const bookingId = String(req.params.bookingId);
      getBooking(bookingId);
      const people = db.prepare(
        "SELECT id FROM participants WHERE booking_id=? AND active=1 AND checked_in=1 ORDER BY team_index,created_at LIMIT 12"
      ).all(bookingId) as Row[];
      const gear = db.prepare(
        "SELECT code FROM equipment WHERE status IN ('available','assigned') ORDER BY code LIMIT 12"
      ).all() as Row[];
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE participants SET equipment_code='',updated_at=? WHERE booking_id=?").run(now(),bookingId);
        people.forEach((person,index) => {
          if (gear[index]) db.prepare("UPDATE participants SET equipment_code=?,updated_at=? WHERE id=?")
            .run(gear[index].code,now(),person.id);
        });
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      res.json(eventData(bookingId,true));
    });

    app.patch("/api/admin/equipment/:code", (req,res) => {
      const code=safeText(req.params.code,32);
      const statuses=["available","assigned","charging","maintenance","damaged"];
      if (!statuses.includes(req.body.status)) fail(400,"Choose a valid equipment status.");
      const battery=Number(req.body.battery);
      if (!Number.isInteger(battery) || battery<0 || battery>100) fail(400,"Battery must be 0–100.");
      const result=db.prepare("UPDATE equipment SET status=?,battery=?,notes=?,updated_at=? WHERE code=?")
        .run(req.body.status,battery,text(req.body.notes ?? "","equipment notes",500),now(),code);
      if (!result.changes) fail(404,"Equipment not found.");
      res.json({ok:true});
    });

    app.post("/api/admin/events/:bookingId/rounds/generate", (req,res) => {
      const bookingId=String(req.params.bookingId);
      const booking=getBooking(bookingId);
      const payload=JSON.parse(booking.payload);
      const active=db.prepare("SELECT DISTINCT team_index FROM participants WHERE booking_id=? AND active=1 AND team_index>=0 ORDER BY team_index")
        .all(bookingId) as Row[];
      if (active.length<2) fail(400,"At least two assigned teams are required.");
      const teams=active.map((row)=>Number(row.team_index));
      const pairs:Array<[number,number]>=[];
      for(let left=0;left<teams.length;left++) for(let right=left+1;right<teams.length;right++) pairs.push([teams[left],teams[right]]);
      const requested=Number(req.body.durationMinutes);
      const availableMinutes=Math.max(15,Number(payload.summary?.totalMissionMinutes ?? payload.mission?.durationMinutes ?? 60));
      const automatic=Math.max(5,Math.min(15,Math.floor(availableMinutes/Math.max(1,pairs.length))));
      const durationMinutes=Number.isInteger(requested) && requested>=5 && requested<=30 ? requested : automatic;
      const mode=text(req.body.mode ?? "Team Battle","round mode",80,2);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM event_rounds WHERE booking_id=?").run(bookingId);
        pairs.forEach(([teamA,teamB],index)=>db.prepare(
          "INSERT INTO event_rounds(id,booking_id,round_no,team_a,team_b,mode,duration_seconds) VALUES(?,?,?,?,?,?,?)"
        ).run(randomUUID(),bookingId,index+1,teamA,teamB,mode,durationMinutes*60));
        db.prepare("UPDATE event_profiles SET event_status='ready',updated_at=? WHERE booking_id=?").run(now(),bookingId);
        db.exec("COMMIT");
      } catch(error){db.exec("ROLLBACK");throw error;}
      res.json(eventData(bookingId,true));
    });

    app.patch("/api/admin/events/:bookingId/rounds/:roundId", (req,res) => {
      const bookingId=String(req.params.bookingId), roundId=String(req.params.roundId);
      getBooking(bookingId);
      const round=db.prepare("SELECT * FROM event_rounds WHERE id=? AND booking_id=?").get(roundId,bookingId) as Row | undefined;
      if(!round) fail(404,"Round not found.");
      const current = round as Row;
      const action=typeof req.body.action==="string" ? req.body.action : "score";
      const stamp=now();
      if(action==="start"){
        db.prepare("UPDATE event_rounds SET status='paused',elapsed_seconds=elapsed_seconds+MAX(0,CAST((julianday(?) - julianday(started_at))*86400 AS INTEGER)),started_at='' WHERE booking_id=? AND status='live' AND id<>?")
          .run(stamp,bookingId,roundId);
        db.prepare("UPDATE event_rounds SET status='live',started_at=?,ended_at='' WHERE id=?").run(stamp,roundId);
        db.prepare("UPDATE event_profiles SET event_status='live',updated_at=? WHERE booking_id=?").run(stamp,bookingId);
      } else if(action==="pause" && current.status==="live"){
        const extra=current.started_at ? Math.max(0,Math.floor((Date.now()-Date.parse(current.started_at))/1000)) : 0;
        db.prepare("UPDATE event_rounds SET status='paused',elapsed_seconds=?,started_at='' WHERE id=?").run(current.elapsed_seconds+extra,roundId);
      } else if(action==="resume" && current.status==="paused"){
        db.prepare("UPDATE event_rounds SET status='live',started_at=? WHERE id=?").run(stamp,roundId);
      } else if(action==="complete"){
        const extra=current.status==="live" && current.started_at ? Math.max(0,Math.floor((Date.now()-Date.parse(current.started_at))/1000)) : 0;
        db.prepare("UPDATE event_rounds SET status='completed',elapsed_seconds=?,started_at='',ended_at=?,score_a=?,score_b=?,objective_a=?,objective_b=?,notes=? WHERE id=?")
          .run(
            current.elapsed_seconds+extra,stamp,
            Math.max(0,Math.floor(Number(req.body.scoreA ?? current.score_a))),
            Math.max(0,Math.floor(Number(req.body.scoreB ?? current.score_b))),
            Math.max(0,Math.floor(Number(req.body.objectiveA ?? current.objective_a))),
            Math.max(0,Math.floor(Number(req.body.objectiveB ?? current.objective_b))),
            text(req.body.notes ?? current.notes,"round notes",500),roundId
          );
      } else if(action==="reset"){
        db.prepare("UPDATE event_rounds SET status='pending',started_at='',elapsed_seconds=0,ended_at='',score_a=0,score_b=0,objective_a=0,objective_b=0,notes='' WHERE id=?").run(roundId);
      } else {
        db.prepare("UPDATE event_rounds SET score_a=?,score_b=?,objective_a=?,objective_b=?,notes=? WHERE id=?")
          .run(
            Math.max(0,Math.floor(Number(req.body.scoreA ?? current.score_a))),
            Math.max(0,Math.floor(Number(req.body.scoreB ?? current.score_b))),
            Math.max(0,Math.floor(Number(req.body.objectiveA ?? current.objective_a))),
            Math.max(0,Math.floor(Number(req.body.objectiveB ?? current.objective_b))),
            text(req.body.notes ?? current.notes,"round notes",500),roundId
          );
      }
      res.json(eventData(bookingId,true));
    });

    app.post("/api/admin/events/:bookingId/final", (req,res) => {
      const bookingId=String(req.params.bookingId);
      getBooking(bookingId);
      const board=leaderboard(bookingId);
      if(board.length<2) fail(400,"Complete preliminary rounds before creating a final.");
      const existing=(db.prepare("SELECT MAX(round_no) AS n FROM event_rounds WHERE booking_id=?").get(bookingId) as Row).n ?? 0;
      const duration=Math.max(5,Math.min(20,Math.floor(Number(req.body.durationMinutes)||10)));
      db.prepare("INSERT INTO event_rounds(id,booking_id,round_no,team_a,team_b,mode,duration_seconds) VALUES(?,?,?,?,?,?,?)")
        .run(randomUUID(),bookingId,existing+1,board[0].teamIndex,board[1].teamIndex,"Championship Final",duration*60);
      res.json(eventData(bookingId,true));
    });

    app.post("/api/admin/events/:bookingId/status", (req,res) => {
      const bookingId=String(req.params.bookingId); getBooking(bookingId);
      const statuses=["registration","ready","live","complete"];
      if(!statuses.includes(req.body.status)) fail(400,"Choose a valid event status.");
      db.prepare("UPDATE event_profiles SET event_status=?,updated_at=? WHERE booking_id=?").run(req.body.status,now(),bookingId);
      res.json(eventData(bookingId,true));
    });

    app.post("/api/admin/events/:bookingId/incidents", (req,res) => {
      const bookingId=String(req.params.bookingId); getBooking(bookingId);
      const kinds=["safety","equipment","weather","venue","other"];
      const kind=kinds.includes(req.body.kind) ? req.body.kind : "other";
      db.prepare("INSERT INTO event_incidents(id,booking_id,at,kind,note,resolved) VALUES(?,?,?,?,?,0)")
        .run(randomUUID(),bookingId,now(),kind,text(req.body.note,"incident note",1000,2));
      res.status(201).json(eventData(bookingId,true));
    });

    app.patch("/api/admin/events/:bookingId/incidents/:incidentId", (req,res) => {
      const bookingId=String(req.params.bookingId); getBooking(bookingId);
      if(typeof req.body.resolved!=="boolean") fail(400,"Choose incident status.");
      const result=db.prepare("UPDATE event_incidents SET resolved=?,resolved_at=? WHERE id=? AND booking_id=?")
        .run(req.body.resolved?1:0,req.body.resolved?now():"",String(req.params.incidentId),bookingId);
      if(!result.changes) fail(404,"Incident not found.");
      res.json(eventData(bookingId,true));
    });

    app.post("/api/admin/events/:bookingId/send-message", async (req,res,next) => {
      try {
        const bookingId=String(req.params.bookingId); getBooking(bookingId);
        const type = String(req.body.type ?? "") as "confirmation" | "reminder_7d" | "reminder_1d" | "results";
        if (!["confirmation","reminder_7d","reminder_1d","results"].includes(type))
          fail(400,"Choose a valid event message.");
        if (type === "results") {
          const profile = db.prepare("SELECT event_status FROM event_profiles WHERE booking_id=?").get(bookingId) as Row | undefined;
          if (profile?.event_status !== "complete") fail(409,"Complete the event before sending results.");
        }
        const result = await sendEventMessage(bookingId,type);
        if (!result.sent) fail(503,result.detail || "Email delivery is unavailable.");
        res.json({ok:true});
      } catch(error){ next(error); }
    });

    app.get("/api/admin/events/:bookingId/communications", (req,res) => {
      const bookingId=String(req.params.bookingId); getBooking(bookingId);
      res.json(db.prepare(
        "SELECT type,sent_at AS sentAt,status,detail FROM communications WHERE booking_id=? ORDER BY sent_at DESC"
      ).all(bookingId));
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
