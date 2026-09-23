import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { rateLimit } from "express-rate-limit";
type Row = Record<string, any>;
const localDay = (date = new Date()) =>
  date.toLocaleDateString("en-CA", { timeZone: "America/St_Lucia" });
const rate = (a: number, b: number) =>
  b ? Math.round((a / b) * 1000) / 10 : null;
export function installKpis(
  app: Express,
  db: DatabaseSync,
  origin: string,
  fail: (status: number, message: string) => never,
) {
  const columns = db.prepare("PRAGMA table_info(bookings)").all() as Row[];
  for (const name of ["visit_id", "campaign_id"]) {
    if (!columns.some((c) => c.name === name))
      db.exec(
        `ALTER TABLE bookings ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`,
      );
  }
  db.exec(`CREATE TABLE IF NOT EXISTS analytics(day TEXT NOT NULL,visit_hash TEXT NOT NULL,event TEXT NOT NULL,PRIMARY KEY(day,visit_hash,event));
    CREATE TABLE IF NOT EXISTS campaign_clicks(campaign_id TEXT NOT NULL,contact_id TEXT NOT NULL,first_at TEXT NOT NULL,PRIMARY KEY(campaign_id,contact_id));
    CREATE TABLE IF NOT EXISTS kpi_targets(key TEXT PRIMARY KEY,value REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  db.prepare(
    "INSERT OR IGNORE INTO metadata VALUES ('tracking_started',?)",
  ).run(new Date().toISOString());
  app.post(
    "/api/analytics",
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    (req, res) => {
      if (
        !["landing", "booking_started"].includes(req.body?.event) ||
        !validVisit(req.body?.visitId)
      )
        return res.status(400).json({ error: "Invalid event." });
      db.prepare("INSERT OR IGNORE INTO analytics VALUES (?,?,?)").run(
        localDay(),
        hashVisit(req.body.visitId),
        req.body.event,
      );
      res.status(204).end();
    },
  );
  app.get("/campaign-click/:campaign/:token", (req, res) => {
    const contact = db
      .prepare("SELECT id FROM contacts WHERE token=?")
      .get(String(req.params.token)) as Row;
    const campaign = db
      .prepare("SELECT id FROM campaigns WHERE id=?")
      .get(String(req.params.campaign)) as Row;
    if (
      !contact ||
      !campaign ||
      !db
        .prepare(
          "SELECT 1 FROM deliveries WHERE campaign_id=? AND contact_id=?",
        )
        .get(campaign.id, contact.id)
    )
      return fail(404, "Campaign link not found.");
    db.prepare("INSERT OR IGNORE INTO campaign_clicks VALUES (?,?,?)").run(
      campaign.id,
      contact.id,
      new Date().toISOString(),
    );
    res
      .set("Cache-Control", "no-store")
      .redirect(
        `${new URL(origin).origin}/?campaign=${encodeURIComponent(campaign.id)}#booking`,
      );
  });
  app.get("/api/admin/kpis", (req, res) => {
    const today = localDay(),
      from = String(req.query.from || today.slice(0, 8) + "01"),
      to = String(req.query.to || today);
    const valid = (d: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      Number.isFinite(Date.parse(d)) &&
      new Date(d).toISOString().slice(0, 10) === d;
    if (!valid(from) || !valid(to) || from > to || to > today)
      return fail(400, "Select a valid date range ending today or earlier.");
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (days > 366) return fail(400, "Choose a date range of up to 366 days.");
    const beforeTo = new Date(Date.parse(from) - 86400000)
        .toISOString()
        .slice(0, 10),
      beforeFrom = new Date(Date.parse(from) - days * 86400000)
        .toISOString()
        .slice(0, 10);
    const all = db
      .prepare("SELECT * FROM bookings ORDER BY created_at")
      .all() as Row[];
    const between = (d: string, a = from, b = to) => d >= a && d <= b;
    const cohort = (a: string, b: string) =>
      all.filter((r) => between(localDay(new Date(r.created_at)), a, b));
    const current = cohort(from, to),
      previous = cohort(beforeFrom, beforeTo);
    const operational = (rows: Row[], a: string, b: string) => {
      const histories = db
        .prepare(
          "SELECT booking_id,MIN(at) AS at FROM history WHERE message<>'Booking request received.' GROUP BY booking_id",
        )
        .all() as Row[];
      const response = rows.flatMap((r) => {
        const h = histories.find((h) => h.booking_id === r.id);
        return h
          ? [
              Math.max(
                0,
                (Date.parse(h.at) - Date.parse(r.created_at)) / 3600000,
              ),
            ]
          : [];
      });
      const returning = rows.filter((r) =>
        all.some(
          (p) =>
            p.email.toLowerCase() === r.email.toLowerCase() &&
            p.created_at < r.created_at,
        ),
      ).length;
      const successful = rows.filter((r) =>
        ["confirmed", "completed"].includes(r.status),
      ).length;
      const visits = (
        db
          .prepare(
            "SELECT COUNT(DISTINCT visit_hash) AS n FROM analytics WHERE day BETWEEN ? AND ? AND event='landing'",
          )
          .get(a, b) as Row
      ).n;
      const starts = (
        db
          .prepare(
            "SELECT COUNT(DISTINCT visit_hash) AS n FROM analytics WHERE day BETWEEN ? AND ? AND event='booking_started'",
          )
          .get(a, b) as Row
      ).n;
      const conversions = new Set(
        rows
          .filter(
            (r) =>
              r.visit_id &&
              db
                .prepare(
                  "SELECT 1 FROM analytics WHERE visit_hash=? AND event='landing' AND day BETWEEN ? AND ?",
                )
                .get(r.visit_id, a, b),
          )
          .map((r) => r.visit_id),
      ).size;
      return {
        requests: rows.length,
        confirmed: successful,
        confirmationRate: rate(successful, rows.length),
        cancelled: rows.filter((r) => r.status === "cancelled").length,
        cancellationRate: rate(
          rows.filter((r) => r.status === "cancelled").length,
          rows.length,
        ),
        responseHours: response.length
          ? Math.round(
              (response.reduce((a, b) => a + b, 0) / response.length) * 10,
            ) / 10
          : null,
        repeatRate: rate(returning, rows.length),
        visits,
        starts,
        conversionRate: rate(conversions, visits),
      };
    };
    const op = operational(current, from, to),
      prev = operational(previous, beforeFrom, beforeTo);
    const card = (
      id: string,
      label: string,
      value: number | null,
      previous: number | null,
      unit = "number",
      detail = "",
    ) => ({ id, label, value, previous, unit, detail });
    const operations = {
      cards: [
        card("requests", "Booking requests", op.requests, prev.requests),
        card(
          "confirmed",
          "Confirmed or completed",
          op.confirmed,
          prev.confirmed,
          "number",
          "Current status of requests created in this period.",
        ),
        card(
          "confirmationRate",
          "Request confirmation rate",
          op.confirmationRate,
          prev.confirmationRate,
          "percent",
          "Confirmed + completed / all requests in the cohort.",
        ),
        card(
          "cancellationRate",
          "Cancellation rate",
          op.cancellationRate,
          prev.cancellationRate,
          "percent",
          "Current cancelled status / requests in the cohort.",
        ),
        card(
          "responseHours",
          "Average first staff action",
          op.responseHours,
          prev.responseHours,
          "hours",
          "Time from request to first saved staff action; excludes untouched requests.",
        ),
        card(
          "repeatRate",
          "Repeat request rate",
          op.repeatRate,
          prev.repeatRate,
          "percent",
          "Requests from email addresses with an earlier request.",
        ),
        card(
          "pending",
          "Pending backlog",
          all.filter((r) => r.status === "pending").length,
          null,
          "number",
          "Current snapshot, across all dates.",
        ),
        card(
          "overdue",
          "Pending with event date passed",
          all.filter((r) => r.status === "pending" && r.date < today).length,
          null,
          "number",
          "Current snapshot; review or reschedule these requests.",
        ),
        card(
          "upcoming",
          "Confirmed events in next 7 days",
          all.filter(
            (r) =>
              r.status === "confirmed" &&
              r.date >= today &&
              r.date <
                new Date(Date.parse(today) + 7 * 86400000)
                  .toISOString()
                  .slice(0, 10),
          ).length,
          null,
          "number",
          "Current event schedule.",
        ),
        card(
          "players",
          "Players at completed events",
          all
            .filter((r) => r.status === "completed" && between(r.date))
            .reduce((n, r) => n + JSON.parse(r.payload).draft.players, 0),
          null,
          "number",
          "Booked headcount, not checked-in attendance; event date in period.",
        ),
      ],
      trend: [] as Row[],
      missions: [] as Row[],
      areas: [] as Row[],
    };
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.parse(from) + i * 86400000)
        .toISOString()
        .slice(0, 10);
      operations.trend.push({
        day,
        requests: current.filter(
          (r) => localDay(new Date(r.created_at)) === day,
        ).length,
      });
    }
    const group = (key: (r: Row) => string) =>
      Object.entries(
        current.reduce(
          (acc, r) => {
            const k = key(r);
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
      )
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => Number(b.count) - Number(a.count));
    operations.missions = group((r) => JSON.parse(r.payload).mission.name);
    operations.areas = group((r) => JSON.parse(r.payload).draft.area);
    const result: Row = {
      from,
      to,
      beforeFrom,
      beforeTo,
      trackingStarted: (
        db
          .prepare("SELECT value FROM metadata WHERE key='tracking_started'")
          .get() as Row
      ).value,
      operations,
      targets: Object.fromEntries(
        db
          .prepare("SELECT * FROM kpi_targets")
          .all()
          .map((r) => [r.key, r.value]),
      ),
    };
    if (res.locals.user.role === "admin" || res.locals.user.finance) {
      const payments = db
        .prepare(
          "SELECT p.*,b.payload FROM payments p JOIN bookings b ON b.id=p.booking_id",
        )
        .all() as Row[];
      const currencies = new Set(
        all.map((r) => JSON.parse(r.payload).summary.currency),
      );
      result.finance = [];
      for (const currency of currencies) {
        const calc = (a: string, b: string) => {
          const rows = payments.filter(
            (p) =>
              JSON.parse(p.payload).summary.currency === currency &&
              between(p.received_on, a, b),
          );
          const received = rows
              .filter((p) => p.kind === "payment")
              .reduce((n, p) => n + p.cents, 0),
            refunded = rows
              .filter((p) => p.kind === "refund")
              .reduce((n, p) => n + p.cents, 0);
          return {
            received,
            refunded,
            net: received - refunded,
            average: rows.filter((p) => p.kind === "payment").length
              ? received /
                new Set(
                  rows
                    .filter((p) => p.kind === "payment")
                    .map((p) => p.booking_id),
                ).size
              : null,
          };
        };
        const c = calc(from, to),
          p = calc(beforeFrom, beforeTo);
        const balances = all
          .filter((r) => JSON.parse(r.payload).summary.currency === currency)
          .map((r) => {
            const estimate = Math.round(
              JSON.parse(r.payload).summary.totalPrice * 100,
            );
            const paid = payments
              .filter((p) => p.booking_id === r.id)
              .reduce(
                (n, p) => n + (p.kind === "payment" ? p.cents : -p.cents),
                0,
              );
            return { status: r.status, estimate, paid };
          });
        result.finance.push({
          currency,
          cards: [
            card(
              "received",
              "Payments received",
              c.received,
              p.received,
              "money",
            ),
            card("refunded", "Refunds paid", c.refunded, p.refunded, "money"),
            card(
              "net",
              "Net cash received",
              c.net,
              p.net,
              "money",
              "Payments minus refunds; not profit or accounting revenue.",
            ),
            card(
              "average",
              "Average receipts per paying booking",
              c.average,
              p.average,
              "money",
              "Gross payments / distinct paying bookings in this period.",
            ),
            card(
              "remaining",
              "Confirmed/completed estimate remaining",
              balances
                .filter((b) => ["confirmed", "completed"].includes(b.status))
                .reduce((n, b) => n + Math.max(0, b.estimate - b.paid), 0),
              null,
              "money",
              "All-time snapshot based on estimates; not issued invoices.",
            ),
            card(
              "credits",
              "Customer credits vs estimates",
              balances.reduce(
                (n, b) => n + Math.max(0, b.paid - b.estimate),
                0,
              ),
              null,
              "money",
              "All-time snapshot; review overpayments individually.",
            ),
          ],
        });
      }
    }
    if (res.locals.user.role === "admin") {
      const campaigns = (
        db.prepare("SELECT * FROM campaigns").all() as Row[]
      ).filter((c) => between(localDay(new Date(c.created_at))));
      const ids = new Set(campaigns.map((c) => c.id));
      const deliveries = (
        db.prepare("SELECT * FROM deliveries").all() as Row[]
      ).filter((d) => ids.has(d.campaign_id));
      const sent = deliveries.filter((d) => d.status === "sent").length;
      const clicks = (
        db.prepare("SELECT * FROM campaign_clicks").all() as Row[]
      ).filter(
        (c) =>
          ids.has(c.campaign_id) &&
          deliveries.some(
            (d) =>
              d.campaign_id === c.campaign_id &&
              d.contact_id === c.contact_id &&
              d.status === "sent",
          ),
      ).length;
      const contacts = db.prepare("SELECT * FROM contacts").all() as Row[];
      const posts = (
        db.prepare("SELECT * FROM social_posts").all() as Row[]
      ).filter((p) => between(localDay(new Date(p.created_at))));
      result.marketing = {
        cards: [
          card(
            "visits",
            "Tracked landing visitors",
            op.visits,
            prev.visits,
            "number",
            "Unique browser-tab identifiers in the period; not unique people.",
          ),
          card("starts", "Tracked booking starts", op.starts, prev.starts),
          card(
            "conversionRate",
            "Tracked landing-to-request rate",
            op.conversionRate,
            prev.conversionRate,
            "percent",
            "Tracked landing visitors who submitted in the same period / tracked landing visitors.",
          ),
          card(
            "subscribers",
            "Subscribed contacts",
            contacts.filter((c) => c.subscribed).length,
            null,
            "number",
            "Current audience snapshot.",
          ),
          card(
            "suppressed",
            "Unsubscribed contacts",
            contacts.filter((c) => !c.subscribed).length,
            null,
            "number",
            "Current suppression snapshot.",
          ),
          card(
            "newContacts",
            "Contacts added",
            contacts.filter((c) => between(localDay(new Date(c.created_at))))
              .length,
            null,
          ),
          card(
            "campaigns",
            "Email drafts/campaigns created",
            campaigns.length,
            null,
          ),
          card(
            "accepted",
            "Emails accepted by SMTP",
            sent,
            null,
            "number",
            "Campaigns created in period; not confirmed inbox delivery.",
          ),
          card(
            "uncertain",
            "Email results needing review",
            deliveries.filter((d) => d.status === "unknown").length,
            null,
          ),
          card(
            "clickRate",
            "Unique tracked email click rate",
            rate(clicks, sent),
            null,
            "percent",
            "Unique campaign/contact CTA clicks / SMTP-accepted messages. Link scanners can inflate clicks.",
          ),
          card(
            "attributed",
            "Email-attributed booking requests",
            current.filter((r) => r.campaign_id).length,
            null,
            "number",
            "Last clicked campaign stored in browser tab; includes self-reported attribution.",
          ),
          card(
            "socialPublished",
            "Social posts confirmed published",
            posts.filter((p) => p.status === "published").length,
            null,
          ),
          card(
            "socialSubmitted",
            "Social videos submitted",
            posts.filter((p) => p.status === "submitted").length,
            null,
            "number",
            "Awaiting platform processing; not assumed published.",
          ),
          card(
            "socialUnknown",
            "Social results needing review",
            posts.filter((p) => p.status === "unknown").length,
            null,
          ),
        ],
        unavailable: [
          "Social impressions, reach, engagement, followers and ad spend require platform insights integrations; publishing tokens alone do not supply them.",
          "Email opens, confirmed inbox deliveries and bounces are not measured; this release has no tracking pixels or delivery webhooks.",
          "Profit, return on ad spend and acquisition cost require expense and advertising-cost records.",
          "Capacity utilisation and actual attendance require capacity calendars and check-in records.",
        ],
      };
    }
    res.json(result);
  });
  app.put("/api/admin/kpi-targets", (req, res) => {
    if (res.locals.user.role !== "admin")
      return fail(403, "Administrator access required.");
    const allowed = [
      "requests",
      "confirmationRate",
      "cancellationRate",
      "responseHours",
      "repeatRate",
      "conversionRate",
    ];
    if (
      !allowed.includes(req.body.key) ||
      typeof req.body.value !== "number" ||
      !Number.isFinite(req.body.value) ||
      req.body.value < 0 ||
      req.body.value > 100000 ||
      (req.body.key.endsWith("Rate") && req.body.value > 100)
    )
      return fail(400, "Check target.");
    db.prepare(
      "INSERT INTO kpi_targets VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(req.body.key, req.body.value);
    res.json({ ok: true });
  });
}
export const validVisit = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d-]{36}$/i.test(v);
export const hashVisit = (v: string) =>
  createHash("sha256").update(v).digest("hex");
