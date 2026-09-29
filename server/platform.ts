import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

const MAX_SKEW_MS = 5 * 60 * 1000;

function safeEqualHex(a: string, b: string) {
  try {
    const left = Buffer.from(String(a), "hex");
    const right = Buffer.from(String(b), "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function verifyPlatform(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timestamp = String(req.get("x-v79-timestamp") || "");
    const signature = String(req.get("x-v79-signature") || "");
    const serviceId = String(req.get("x-v79-service-id") || "");
    if (secret.length < 32) return res.status(503).json({ error: "V79 platform integration is not configured." });
    if (serviceId !== "v79-hub" || !timestamp || !signature) {
      return res.status(401).json({ error: "Invalid V79 platform credentials." });
    }
    const when = Number(timestamp);
    if (!Number.isFinite(when) || Math.abs(Date.now() - when) > MAX_SKEW_MS) {
      return res.status(401).json({ error: "Expired V79 platform request." });
    }
    const pathname = new URL(req.originalUrl, "http://v79.internal").pathname;
    const bodyHash = crypto.createHash("sha256").update("").digest("hex");
    const canonical = [req.method.toUpperCase(), pathname, timestamp, bodyHash].join("\n");
    const expected = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
    if (!safeEqualHex(expected, signature)) {
      return res.status(401).json({ error: "Invalid V79 platform signature." });
    }
    next();
  };
}

function todayInSaintLucia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/St_Lucia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bookingPayload(row: any) {
  try { return JSON.parse(String(row.payload || "{}")); } catch { return {}; }
}

export function installPlatformReadOnly(app: Express, db: DatabaseSync, secret: string) {
  const verify = verifyPlatform(secret);

  app.get("/api/platform/summary/:subject", verify, (req, res) => {
    const subject = String(req.params.subject || "").trim();
    if (!/^[A-Za-z0-9._:@-]{1,180}$/.test(subject)) {
      return res.status(400).json({ error: "Invalid platform subject." });
    }

    const today = todayInSaintLucia();
    const rows = db.prepare(
      "SELECT reference,status,date,time,name,payload FROM bookings ORDER BY date,time"
    ).all() as any[];
    const counts = Object.fromEntries(["pending","confirmed","completed","cancelled"].map(status => [
      status,
      rows.filter(row => row.status === status).length,
    ]));
    const upcoming = rows
      .filter(row => row.date >= today && ["pending","confirmed"].includes(String(row.status)))
      .slice(0, 12)
      .map(row => {
        const payload = bookingPayload(row);
        return {
          reference: row.reference,
          status: row.status,
          date: row.date,
          time: row.time,
          customer: row.name,
          players: Number(payload?.draft?.players || 0),
          mission: String(payload?.mission?.name || payload?.mission?.title || payload?.draft?.missionId || ""),
          estimatedTotalXcd: Number(payload?.summary?.total || payload?.summary?.totalPrice || 0),
        };
      });
    const upcomingPlayers = upcoming.reduce((sum, row) => sum + row.players, 0);

    return res.json({
      product: "lasertag",
      subjectId: subject,
      generatedAt: new Date().toISOString(),
      metrics: {
        totalBookings: rows.length,
        bookingsByStatus: counts,
        upcomingBookings: upcoming.length,
        upcomingPlayers,
      },
      upcoming,
    });
  });

  app.get("/api/platform/admin/stats", verify, (_req, res) => {
    const rows = db.prepare("SELECT status,date,payload FROM bookings").all() as any[];
    const today = todayInSaintLucia();
    const next30 = new Date();
    next30.setDate(next30.getDate() + 30);
    const next30Date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/St_Lucia",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(next30);
    const upcomingRows = rows.filter(row => row.date >= today && row.date <= next30Date && ["pending","confirmed"].includes(String(row.status)));
    const playerCount = upcomingRows.reduce((sum, row) => sum + Number(bookingPayload(row)?.draft?.players || 0), 0);
    const counts = Object.fromEntries(["pending","confirmed","completed","cancelled"].map(status => [
      status,
      rows.filter(row => row.status === status).length,
    ]));
    return res.json({
      totalBookings: rows.length,
      bookingsByStatus: counts,
      bookingsNext30Days: upcomingRows.length,
      playersNext30Days: playerCount,
      generatedAt: new Date().toISOString(),
    });
  });
}
