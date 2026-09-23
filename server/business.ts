import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes } from "node:crypto";
import {
  mkdirSync,
  unlinkSync,
  statSync,
  renameSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const runFile = promisify(execFile);
import multer from "multer";
import nodemailer from "nodemailer";
import type { ServerConfig } from "./app";
import { publishSocial, socialConnections, tiktokCreator } from "./social";
type Row = Record<string, any>;
export function installBusiness(
  app: Express,
  db: DatabaseSync,
  config: ServerConfig,
  helpers: any,
) {
  const { fail, text, derive } = helpers;
  const admin = (_req: Request, res: Response, next: NextFunction) =>
    res.locals.user.role === "admin"
      ? next()
      : next(
          Object.assign(new Error("Administrator access required."), {
            status: 403,
          }),
        );
  const finance = (_req: Request, res: Response, next: NextFunction) =>
    res.locals.user.role === "admin" || res.locals.user.finance
      ? next()
      : next(
          Object.assign(new Error("Finance access required."), { status: 403 }),
        );
  const now = () => new Date().toISOString();
  const email = (value: unknown) => {
    const v = text(value, "email", 254, 3).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
      fail(400, "Enter a valid email.");
    return v;
  };
  const audit = (res: Response, action: string) =>
    db
      .prepare("INSERT INTO audit(at,actor,action) VALUES (?,?,?)")
      .run(now(), res.locals.user.id, action);
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL REFERENCES bookings(id),cents INTEGER NOT NULL CHECK(cents>0),kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),method TEXT NOT NULL,received_on TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,request_key TEXT UNIQUE NOT NULL);
    CREATE INDEX IF NOT EXISTS payments_booking_date ON payments(booking_id,received_on);
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL,public INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS content(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,event_date TEXT NOT NULL,location TEXT NOT NULL,media_id TEXT,live INTEGER NOT NULL DEFAULT 0,design TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,segment TEXT NOT NULL,basis TEXT NOT NULL,subscribed INTEGER NOT NULL DEFAULT 1,token TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,subject TEXT NOT NULL,body TEXT NOT NULL,segment TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft');
    CREATE TABLE IF NOT EXISTS deliveries(campaign_id TEXT NOT NULL REFERENCES campaigns(id),contact_id TEXT NOT NULL REFERENCES contacts(id),status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',PRIMARY KEY(campaign_id,contact_id));
    CREATE TABLE IF NOT EXISTS social_posts(id TEXT PRIMARY KEY,content_id TEXT NOT NULL,platform TEXT NOT NULL,status TEXT NOT NULL,remote_id TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
  `);
  if (
    !(db.prepare("PRAGMA table_info(campaigns)").all() as Row[]).some(
      (c) => c.name === "media_id",
    )
  )
    db.exec("ALTER TABLE campaigns ADD COLUMN media_id TEXT");
  app.locals.jobs = new Set<Promise<void>>();
  // A crash during a provider call is ambiguous. Never retry it automatically.
  db.exec(
    "UPDATE deliveries SET status='unknown',detail='Interrupted; check provider before retrying.' WHERE status IN ('sending','queued'); UPDATE campaigns SET status='review' WHERE status='sending'; UPDATE social_posts SET status='unknown',detail='Interrupted; check platform before reposting.' WHERE status='sending'",
  );
  app.get("/api/admin/users", admin, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,email,name,role,finance,active,created_at FROM users ORDER BY created_at",
        )
        .all(),
    ),
  );
  async function credentials(password: unknown) {
    if (
      typeof password !== "string" ||
      password.length < 16 ||
      password.length > 256
    )
      fail(400, "Use a password of 16–256 characters.");
    const salt = randomBytes(32).toString("hex");
    return {
      salt,
      hash: (await derive(password, Buffer.from(salt, "hex"), 64)).toString(
        "hex",
      ),
    };
  }
  app.post("/api/admin/users", admin, async (req, res) => {
    const address = email(req.body.email);
    const name = text(req.body.name, "name", 120, 2);
    if (
      address === config.adminUsername.toLowerCase() ||
      db.prepare("SELECT id FROM users WHERE email=?").get(address)
    )
      fail(409, "This email is already in use.");
    if (
      !["admin", "staff"].includes(req.body.role) ||
      typeof req.body.finance !== "boolean"
    )
      fail(400, "Choose a role and finance permission.");
    const c = await credentials(req.body.password);
    const id = randomUUID();
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)").run(
      id,
      address,
      name,
      c.salt,
      c.hash,
      req.body.role,
      req.body.finance ? 1 : 0,
      1,
      now(),
    );
    audit(res, `Created user ${id} (${req.body.role}).`);
    res.status(201).json({ id });
  });
  app.patch("/api/admin/users/:id", admin, async (req, res) => {
    const id = String(req.params.id);
    if (id === res.locals.user.id)
      fail(400, "Another administrator must change your access.");
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(id) as Row;
    if (!user) fail(404, "User not found.");
    if (
      !["admin", "staff"].includes(req.body.role) ||
      typeof req.body.finance !== "boolean" ||
      typeof req.body.active !== "boolean"
    )
      fail(400, "Invalid access settings.");
    const c = req.body.password
      ? await credentials(req.body.password)
      : { salt: user.salt, hash: user.password_hash };
    db.prepare(
      "UPDATE users SET role=?,finance=?,active=?,salt=?,password_hash=? WHERE id=?",
    ).run(
      req.body.role,
      req.body.finance ? 1 : 0,
      req.body.active ? 1 : 0,
      c.salt,
      c.hash,
      id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    audit(res, `Updated access for ${id}; sessions revoked.`);
    res.json({ ok: true });
  });
  app.get("/api/admin/audit", admin, (_req, res) =>
    res.json(
      db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 200").all(),
    ),
  );
  app.get("/api/admin/finance", finance, (req, res) => {
    const from = String(req.query.from || "0000-01-01"),
      to = String(req.query.to || "9999-12-31");
    if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) || from > to)
      fail(400, "Check date range.");
    const ledger = db
      .prepare(
        "SELECT p.*,b.reference,b.name,b.payload FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE received_on BETWEEN ? AND ? ORDER BY received_on DESC,created_at DESC",
      )
      .all(from, to) as Row[];
    const totals: Record<
      string,
      { received: number; refunded: number; net: number }
    > = {};
    ledger.forEach((p) => {
      const currency = JSON.parse(p.payload).summary.currency;
      delete p.payload;
      p.currency = currency;
      const t = (totals[currency] ??= { received: 0, refunded: 0, net: 0 });
      t[p.kind === "payment" ? "received" : "refunded"] += p.cents;
      t.net += p.kind === "payment" ? p.cents : -p.cents;
    });
    const bookings = (
      db
        .prepare(
          "SELECT id,reference,name,status,payload FROM bookings ORDER BY date DESC",
        )
        .all() as Row[]
    ).map((b) => {
      const summary = JSON.parse(b.payload).summary;
      const paid = (
        db
          .prepare(
            "SELECT COALESCE(SUM(CASE WHEN kind='payment' THEN cents ELSE -cents END),0) AS cents FROM payments WHERE booking_id=?",
          )
          .get(b.id) as Row
      ).cents;
      return {
        id: b.id,
        reference: b.reference,
        name: b.name,
        status: b.status,
        currency: summary.currency,
        estimate: Math.round(summary.totalPrice * 100),
        paid,
        balance: Math.max(0, Math.round(summary.totalPrice * 100) - paid),
        credit: Math.max(0, paid - Math.round(summary.totalPrice * 100)),
      };
    });
    res.json({ totals, ledger, bookings });
  });
  app.post("/api/admin/finance/payments", finance, (req, res) => {
    const b = req.body;
    const booking = helpers.getBooking(text(b.bookingId, "booking", 36, 36));
    if (
      !Number.isSafeInteger(b.cents) ||
      b.cents < 1 ||
      b.cents > 100000000 ||
      !["payment", "refund"].includes(b.kind)
    )
      fail(400, "Enter a valid positive amount and transaction type.");
    const method = text(b.method, "payment method", 40, 2),
      note = text(b.note ?? "", "note", 500);
    const date = text(b.receivedOn, "payment date", 10, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      date >
        new Date().toLocaleDateString("en-CA", { timeZone: "America/St_Lucia" })
    )
      fail(400, "Choose a valid payment date, not in the future.");
    const key = text(b.requestKey, "request key", 36, 36);
    const prior = db
      .prepare("SELECT * FROM payments WHERE request_key=?")
      .get(key) as Row;
    if (prior) {
      if (
        prior.booking_id !== booking.id ||
        prior.cents !== b.cents ||
        prior.kind !== b.kind ||
        prior.method !== method ||
        prior.note !== note ||
        prior.received_on !== date
      )
        fail(409, "Request key already used.");
      return res.json({ id: prior.id });
    }
    const paid = (
      db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN kind='payment' THEN cents ELSE -cents END),0) AS cents FROM payments WHERE booking_id=?",
        )
        .get(booking.id) as Row
    ).cents;
    if (b.kind === "refund" && b.cents > paid)
      fail(400, "Refund exceeds recorded net payments.");
    const id = randomUUID();
    db.prepare("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      id,
      booking.id,
      b.cents,
      b.kind,
      method,
      date,
      note,
      res.locals.user.id,
      now(),
      key,
    );
    audit(res, `Recorded ${b.kind} ${id} for ${booking.reference}.`);
    res.status(201).json({ id });
  });
  const mediaDir = resolve(dirname(config.databasePath), "media");
  mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
  const upload = multer({
    dest: mediaDir,
    limits: { fileSize: 80 * 1024 * 1024, files: 1, fields: 0 },
  });
  let uploading = false;
  app.post(
    "/api/admin/media",
    admin,
    (_req, res, next) => {
      if (uploading)
        return fail(429, "Another upload is processing. Try again shortly.");
      uploading = true;
      res.once("finish", () => {
        uploading = false;
      });
      res.once("close", () => {
        uploading = false;
      });
      next();
    },
    upload.single("file"),
    async (req, res) => {
      if (!req.file) fail(400, "Choose an image or video.");
      const f = req.file!,
        buf = Buffer.alloc(32);
      const fd = openSync(f.path, "r");
      try {
        readSync(fd, buf, 0, 32, 0);
      } finally {
        closeSync(fd);
      }
      let mime = "";
      if (
        buf
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        mime = "image/png";
      else if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255)
        mime = "image/jpeg";
      else if (
        buf.subarray(0, 4).toString() === "RIFF" &&
        buf.subarray(8, 12).toString() === "WEBP"
      )
        mime = "image/webp";
      else if (buf.subarray(4, 8).toString() === "ftyp") mime = "video/mp4";
      else if (buf.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))
        mime = "video/webm";
      if (!mime || (mime.startsWith("image/") && f.size > 15 * 1024 * 1024)) {
        unlinkSync(f.path);
        fail(400, "Use PNG, JPEG or WebP (15 MB), MP4 or WebM (80 MB).");
      }
      const output = f.path + ".normalised";
      try {
        // Decode and normalise uploads; no executable/vector formats or remote input protocols.
        const args = [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          f.path,
        ];
        if (mime.startsWith("video/"))
          args.push(
            "-t",
            "60",
            "-vf",
            "scale=w='min(1080,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "2",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            output,
          );
        else
          args.push(
            "-frames:v",
            "1",
            "-vf",
            "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease",
            "-threads",
            "1",
            "-f",
            "image2",
            "-c:v",
            "mjpeg",
            output,
          );
        await runFile("ffmpeg", args, {
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        });
        unlinkSync(f.path);
        renameSync(output, f.path);
        mime = mime.startsWith("video/") ? "video/mp4" : "image/jpeg";
        db.prepare("INSERT INTO media VALUES (?,?,?,?,?,0)").run(
          f.filename,
          f.originalname.replace(/\.[^.]+$/, "").slice(0, 130) +
            (mime === "video/mp4" ? ".mp4" : ".jpg"),
          mime,
          statSync(f.path).size,
          now(),
        );
        res.status(201).json({ id: f.filename });
      } catch {
        for (const path of [f.path, output])
          try {
            unlinkSync(path);
          } catch {}
        fail(
          400,
          "Unable to process this media. Use a valid image/video; FFmpeg must be installed. Videos are limited to 60 seconds.",
        );
      }
    },
  );
  app.get("/api/admin/media", admin, (_req, res) =>
    res.json(db.prepare("SELECT * FROM media ORDER BY created_at DESC").all()),
  );
  const serveMedia = (isPublic: boolean) => (req: Request, res: Response) => {
    const m = db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(String(req.params.id)) as Row;
    if (!m || (isPublic && !m.public)) fail(404, "Media not found.");
    res
      .type(m.mime)
      .set("Cache-Control", isPublic ? "public, max-age=300" : "no-store")
      .sendFile(join(mediaDir, m.id));
  };
  app.get("/api/admin/media/:id", admin, serveMedia(false));
  app.get("/uploads/:id", serveMedia(true));
  app.get("/api/admin/content", admin, (_req, res) =>
    res.json(
      db.prepare("SELECT * FROM content ORDER BY updated_at DESC").all(),
    ),
  );
  app.post("/api/admin/content", admin, (req, res) => {
    const b = req.body,
      id = b.id || randomUUID();
    if (
      !["event", "campaign"].includes(b.kind) ||
      typeof b.live !== "boolean" ||
      (b.live && b.kind !== "event")
    )
      fail(400, "Invalid content type or visibility.");
    const title = text(b.title, "title", 120, 2),
      body = text(b.body, "copy", 5000),
      date = text(b.eventDate ?? "", "event date", 10),
      location = text(b.location ?? "", "location", 150);
    if (
      b.kind === "event" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      fail(400, "Choose an event date.");
    const mediaId = b.mediaId || null;
    if (mediaId && !db.prepare("SELECT id FROM media WHERE id=?").get(mediaId))
      fail(400, "Choose valid media.");
    const design = JSON.stringify(b.design ?? {});
    if (design.length > 10000) fail(400, "Design is too large.");
    const previous = db
      .prepare("SELECT version FROM content WHERE id=?")
      .get(id) as Row;
    if (b.id && (!previous || previous.version !== b.version))
      fail(409, "Content changed. Reload before saving.");
    db.prepare(
      "INSERT INTO content VALUES (?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,body=excluded.body,event_date=excluded.event_date,location=excluded.location,media_id=excluded.media_id,live=excluded.live,design=excluded.design,updated_at=excluded.updated_at,version=version+1",
    ).run(
      id,
      b.kind,
      title,
      body,
      date,
      location,
      mediaId,
      b.live ? 1 : 0,
      design,
      now(),
    );
    if (b.live && mediaId)
      db.prepare("UPDATE media SET public=1 WHERE id=?").run(mediaId);
    audit(res, `Saved ${b.kind} ${id}${b.live ? " (public)" : ""}.`);
    res.json({ id });
  });
  app.get("/api/events", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT c.id,c.title,c.body,c.event_date,c.location,c.media_id,m.mime FROM content c LEFT JOIN media m ON m.id=c.media_id WHERE c.live=1 AND c.kind='event' AND c.event_date>=? ORDER BY c.event_date LIMIT 30",
        )
        .all(
          new Date().toLocaleDateString("en-CA", {
            timeZone: "America/St_Lucia",
          }),
        ),
    ),
  );
  app.get("/api/admin/contacts", admin, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,email,name,segment,basis,subscribed,created_at FROM contacts ORDER BY created_at DESC",
        )
        .all(),
    ),
  );
  app.post("/api/admin/contacts", admin, (req, res) => {
    const address = email(req.body.email),
      name = text(req.body.name, "name", 120, 2),
      segment = text(req.body.segment, "segment", 60, 1),
      basis = text(req.body.basis, "permission/source", 500, 5);
    if (db.prepare("SELECT id FROM contacts WHERE email=?").get(address))
      fail(
        409,
        "Contact exists. An unsubscribed address cannot be re-enabled here.",
      );
    db.prepare("INSERT INTO contacts VALUES (?,?,?,?,?,1,?,?)").run(
      randomUUID(),
      address,
      name,
      segment,
      basis,
      randomBytes(32).toString("hex"),
      now(),
    );
    audit(res, `Added marketing contact ${address}.`);
    res.status(201).json({ ok: true });
  });
  app.post("/api/admin/contacts/import-bookings", admin, (_req, res) => {
    let imported = 0;
    for (const row of db
      .prepare("SELECT payload FROM bookings")
      .all() as Row[]) {
      const c = JSON.parse(row.payload).draft.customer;
      if (c.marketingOptIn)
        imported += Number(
          db
            .prepare("INSERT OR IGNORE INTO contacts VALUES (?,?,?,?,?,1,?,?)")
            .run(
              randomUUID(),
              c.email.toLowerCase(),
              c.fullName,
              "customers",
              "Booking form marketing opt-in",
              randomBytes(32).toString("hex"),
              now(),
            ).changes,
        );
    }
    res.json({ imported });
  });
  app.post("/api/admin/contacts/:id/unsubscribe", admin, (req, res) => {
    db.prepare("UPDATE contacts SET subscribed=0 WHERE id=?").run(
      String(req.params.id),
    );
    res.json({ ok: true });
  });
  app.get("/unsubscribe/:token", (req, res) => {
    const c = db
      .prepare("SELECT id FROM contacts WHERE token=?")
      .get(String(req.params.token));
    if (!c) fail(404, "Link not found.");
    res
      .type("html")
      .send(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><body><h1>CombatZone SLU</h1><form method="post"><p>Stop marketing emails to this address?</p><button>Unsubscribe</button></form></body></html>',
      );
  });
  app.post("/unsubscribe/:token", (req, res) => {
    db.prepare("UPDATE contacts SET subscribed=0 WHERE token=?").run(
      String(req.params.token),
    );
    res
      .type("text")
      .send("You have been unsubscribed from CombatZone SLU marketing emails.");
  });
  const htmlEscape = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const emailHtml = (
    subject: string,
    message: string,
    link: string,
    clickLink: string,
    hero: string,
  ) =>
    `<!doctype html><html><body style="margin:0;background:#0c1710;font-family:Arial,sans-serif;color:#eef5e9"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" style="max-width:600px;width:100%;padding:36px"><tr><td style="color:#c4ff38;font-size:18px;font-weight:bold;letter-spacing:2px">COMBATZONE SLU</td></tr><tr><td>${hero ? `<img src="${htmlEscape(hero)}" alt="CombatZone campaign artwork" width="528" style="width:100%;height:auto;display:block;margin:24px 0">` : ""}<h1 style="font-size:32px;line-height:1.2">${htmlEscape(subject)}</h1><div style="font-size:16px;line-height:1.7;white-space:pre-line">${htmlEscape(message).replaceAll("\n", "<br>")}</div><p style="margin:30px 0"><a style="display:inline-block;padding:16px 24px;background:#c4ff38;color:#0c1710;text-decoration:none;font-weight:bold" href="${htmlEscape(clickLink)}">PLAN YOUR MISSION →</a></p><hr style="border:0;border-top:1px solid #3d5141"><p style="font-size:12px;color:#bbc9b9">CombatZone SLU · ${htmlEscape(process.env.MAIL_BUSINESS_ADDRESS || "")}<br><a style="color:#c4ff38" href="${htmlEscape(link)}">Unsubscribe</a></p></td></tr></table></td></tr></table></body></html>`;
  const mailReady = () =>
    Boolean(
      process.env.SMTP_HOST &&
      process.env.SMTP_FROM &&
      process.env.MAIL_BUSINESS_ADDRESS,
    );
  const transporter = () =>
    nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      requireTLS: process.env.SMTP_PORT !== "465",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 10000,
      socketTimeout: 20000,
    });
  app.get("/api/admin/connections", admin, (_req, res) =>
    res.json({ email: mailReady(), ...socialConnections() }),
  );
  app.get("/api/admin/campaigns", admin, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT c.*, (SELECT COUNT(*) FROM deliveries d WHERE d.campaign_id=c.id AND d.status='sent') AS sent,(SELECT COUNT(*) FROM deliveries d WHERE d.campaign_id=c.id) AS recipients FROM campaigns c ORDER BY created_at DESC",
        )
        .all(),
    ),
  );
  app.post("/api/admin/campaigns", admin, (req, res) => {
    const id = randomUUID(),
      mediaId = req.body.mediaId || null;
    if (
      mediaId &&
      !db
        .prepare("SELECT id FROM media WHERE id=? AND mime='image/jpeg'")
        .get(mediaId)
    )
      fail(400, "Choose a JPEG image for email.");
    db.prepare(
      "INSERT INTO campaigns(id,subject,body,segment,created_at,media_id) VALUES (?,?,?,?,?,?)",
    ).run(
      id,
      text(req.body.subject, "subject", 150, 2),
      text(req.body.body, "email copy", 10000, 10),
      text(req.body.segment ?? "", "segment", 60),
      now(),
      mediaId,
    );
    res.status(201).json({ id });
  });
  app.get("/api/admin/campaigns/:id/deliveries", admin, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT c.email,d.status,d.detail FROM deliveries d JOIN contacts c ON c.id=d.contact_id WHERE campaign_id=?",
        )
        .all(String(req.params.id)),
    ),
  );
  app.post("/api/admin/campaigns/:id/send", admin, async (req, res) => {
    if (!mailReady())
      fail(
        503,
        "Configure SMTP and your business postal address before sending.",
      );
    const id = String(req.params.id),
      c = db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) as Row;
    if (!c) fail(404, "Campaign not found.");
    if (req.body.confirm !== true) fail(400, "Confirm the send.");
    if (c.status !== "draft")
      fail(
        409,
        "This campaign has already been submitted. Review delivery results.",
      );
    const audience = db
      .prepare(
        "SELECT * FROM contacts WHERE subscribed=1 AND (?='' OR segment=?) LIMIT 101",
      )
      .all(c.segment, c.segment) as Row[];
    if (!audience.length || audience.length > 100)
      fail(400, "Select a segment containing 1–100 subscribed contacts.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE campaigns SET status='sending' WHERE id=?").run(id);
      for (const p of audience)
        db.prepare(
          "INSERT INTO deliveries(campaign_id,contact_id,status) VALUES (?,?,'queued')",
        ).run(id, p.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    if (c.media_id)
      db.prepare("UPDATE media SET public=1 WHERE id=?").run(c.media_id);
    audit(
      res,
      `Submitted email campaign ${id} to ${audience.length} contacts.`,
    );
    res.status(202).json({ ok: true, recipients: audience.length });
    // Deliberate, bounded batch; never automatically retry ambiguous SMTP results.
    const job = (async () => {
      const mail = transporter();
      for (const p of audience) {
        if (
          !(
            db
              .prepare("SELECT subscribed FROM contacts WHERE id=?")
              .get(p.id) as Row
          )?.subscribed
        ) {
          db.prepare(
            "UPDATE deliveries SET status='suppressed' WHERE campaign_id=? AND contact_id=?",
          ).run(id, p.id);
          continue;
        }
        db.prepare(
          "UPDATE deliveries SET status='sending' WHERE campaign_id=? AND contact_id=?",
        ).run(id, p.id);
        const link = `${config.publicOrigin}/unsubscribe/${p.token}`;
        try {
          await mail.sendMail({
            from: process.env.SMTP_FROM,
            to: p.email,
            subject: c.subject,
            html: emailHtml(
              c.subject,
              c.body.replaceAll("{{name}}", p.name),
              link,
              `${new URL(config.publicOrigin).origin}/campaign-click/${id}/${p.token}`,
              c.media_id
                ? `${new URL(config.publicOrigin).origin}/uploads/${c.media_id}`
                : "",
            ),
            text: `${c.body.replaceAll("{{name}}", p.name)}\n\nCombatZone SLU\n${process.env.MAIL_BUSINESS_ADDRESS}\nUnsubscribe: ${link}`,
            headers: { "List-Unsubscribe": `<${link}>` },
          });
          db.prepare(
            "UPDATE deliveries SET status='sent' WHERE campaign_id=? AND contact_id=?",
          ).run(id, p.id);
        } catch {
          db.prepare(
            "UPDATE deliveries SET status='unknown',detail='SMTP did not confirm delivery; check provider logs before sending again.' WHERE campaign_id=? AND contact_id=?",
          ).run(id, p.id);
        }
      }
      db.prepare("UPDATE campaigns SET status='finished' WHERE id=?").run(id);
      mail.close();
    })();
    app.locals.jobs.add(job);
    void job
      .catch(() => {
        console.error("Campaign worker interrupted; review delivery log.");
      })
      .finally(() => app.locals.jobs.delete(job));
  });
  app.get("/api/admin/tiktok-creator", admin, async (_req, res) => {
    if (!process.env.TIKTOK_ACCESS_TOKEN) fail(503, "Connect TikTok first.");
    res.json(await tiktokCreator());
  });
  app.post("/api/admin/social-posts/:id/resolve", admin, (req, res) => {
    if (!["published", "failed"].includes(req.body.status))
      fail(400, "Select the verified outcome.");
    const note = text(req.body.note, "verification note", 500, 10),
      remoteId = text(req.body.remoteId ?? "", "platform reference", 200);
    const post = db
      .prepare("SELECT * FROM social_posts WHERE id=?")
      .get(String(req.params.id)) as Row;
    if (!post || !["unknown", "submitted"].includes(post.status))
      fail(409, "This result cannot be reconciled.");
    db.prepare(
      "UPDATE social_posts SET status=?,remote_id=?,detail=? WHERE id=?",
    ).run(
      req.body.status,
      remoteId || post.remote_id,
      "Manually verified: " + note,
      post.id,
    );
    audit(
      res,
      `Reconciled social post ${post.id}: ${req.body.status}. ${note}`,
    );
    res.json({ ok: true });
  });
  app.get("/api/admin/social-posts", admin, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM social_posts ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.post("/api/admin/content/:id/publish", admin, async (req, res) => {
    const c = db
      .prepare(
        "SELECT c.*,m.mime FROM content c LEFT JOIN media m ON m.id=c.media_id WHERE c.id=?",
      )
      .get(String(req.params.id)) as Row;
    if (!c) fail(404, "Content not found.");
    const platform = text(req.body.platform, "platform", 20, 2);
    if (!["facebook", "instagram", "tiktok", "youtube"].includes(platform))
      fail(400, "Choose a platform.");
    if (!(socialConnections() as any)[platform])
      fail(503, "Connect this platform in server configuration first.");
    if (req.body.confirm !== true) fail(400, "Confirm publication.");
    if (
      db
        .prepare(
          "SELECT id FROM social_posts WHERE content_id=? AND platform=? AND status IN ('sending','submitted','published','unknown')",
        )
        .get(c.id, platform)
    )
      fail(409, "Already submitted. Check the platform before posting again.");
    if (["tiktok", "youtube"].includes(platform) && c.mime !== "video/mp4")
      fail(400, "Attach an MP4 video first.");
    if (
      platform === "instagram" &&
      !["image/jpeg", "video/mp4"].includes(c.mime)
    )
      fail(400, "Attach a JPEG or MP4 first.");
    if (
      ["instagram", "tiktok"].includes(platform) &&
      (c.title + "\n\n" + c.body).length > 2200
    )
      fail(400, "Shorten the title and caption to 2,200 characters combined.");
    if (
      platform === "youtube" &&
      (c.title.length > 100 ||
        !["private", "unlisted", "public"].includes(req.body.privacy) ||
        typeof req.body.madeForKids !== "boolean")
    )
      fail(
        400,
        "Use a title up to 100 characters and select visibility and audience.",
      );
    if (platform === "tiktok" && typeof req.body.privacy !== "string")
      fail(400, "Select TikTok visibility.");
    if (c.media_id)
      db.prepare("UPDATE media SET public=1 WHERE id=?").run(c.media_id);
    const id = randomUUID();
    db.prepare(
      "INSERT INTO social_posts(id,content_id,platform,status,created_at) VALUES (?,?,?,'sending',?)",
    ).run(id, c.id, platform, now());
    audit(res, `Submitted ${c.id} to ${platform}.`);
    try {
      const result = await publishSocial(
        platform,
        c,
        config.publicOrigin,
        mediaDir,
        req.body,
      );
      db.prepare(
        "UPDATE social_posts SET status=?,remote_id=?,detail=? WHERE id=?",
      ).run(result.status, result.id, result.detail || "", id);
      res.json(result);
    } catch {
      db.prepare(
        "UPDATE social_posts SET status='unknown',detail='Provider did not confirm publication. Check platform account and credentials before retrying.' WHERE id=?",
      ).run(id);
      fail(
        502,
        "Platform did not confirm publication. Review the publishing log and your platform account.",
      );
    }
  });
}
