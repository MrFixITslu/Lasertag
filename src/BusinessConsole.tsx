import { useEffect, useState, type FormEvent } from "react";
import { api } from "./lib/api";
import Studio from "./Studio";
import "./business.css";
export interface AdminSession {
  username: string;
  csrf: string;
  role: "admin" | "staff";
  finance: boolean;
  id: string;
}
type Row = Record<string, any>;
const money = (cents: number, currency = "XCD") =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    cents / 100,
  );
export function BusinessConsole({
  session,
  section,
}: {
  session: AdminSession;
  section: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [key, setKey] = useState(crypto.randomUUID());
  const headers = { "X-CSRF-Token": session.csrf };
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const endpoint =
      section === "finance"
        ? `finance?from=${from}&to=${to}`
        : section === "users"
          ? "users"
          : section === "audience"
            ? "contacts"
            : section === "email"
              ? "campaigns"
              : section === "connections"
                ? "connections"
                : "audit";
    api(`/api/admin/${endpoint}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [section, revision, from, to]);
  async function action(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Row>(`/api/admin/${path}`, {
        method,
        headers,
        body: JSON.stringify(body),
      });
      setNotice(
        result.recipients
          ? `Sending to ${result.recipients} contacts. Refresh for results.`
          : "Saved.",
      );
      refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  };
  if (section === "marketing") return <Studio session={session} />;
  return (
    <section className="business-panel hud-panel">
      <div className="business-heading">
        <div>
          <p className="eyebrow">COMBATZONE / COMMAND CENTRE</p>
          <h2>
            {
              (
                {
                  finance: "INCOME & PAYMENTS",
                  users: "CREW & ACCESS",
                  audience: "YOUR AUDIENCE",
                  email: "EMAIL CAMPAIGNS",
                  connections: "CHANNEL CONNECTIONS",
                  audit: "ACCESS & ACTIVITY",
                } as Row
              )[section]
            }
          </h2>
        </div>
        <button onClick={refresh}>Refresh</button>
      </div>
      {error && (
        <p role="alert" className="admin-message admin-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="admin-message">
          {notice}
        </p>
      )}
      {section === "finance" && (
        <>
          <p>
            Recorded cash received, less refunds. Estimates are separate from
            income. All amounts stay in their original booking currency.
          </p>
          <div className="business-row">
            <label>
              Payments from
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          {data && (
            <>
              <div className="business-cards">
                {Object.entries(data.totals).map(
                  ([currency, t]: [string, any]) => (
                    <div key={currency}>
                      <small>{currency} · NET RECEIVED</small>
                      <strong>{money(t.net, currency)}</strong>
                      <span>
                        Received {money(t.received, currency)} · Refunded{" "}
                        {money(t.refunded, currency)}
                      </span>
                    </div>
                  ),
                )}
                {!data.ledger.length && (
                  <p>No recorded payments in this period.</p>
                )}
              </div>
              <form
                className="business-form"
                onSubmit={async (e) => {
                  const el = e.currentTarget,
                    b = form(e);
                  const result = await action("finance/payments", {
                    ...b,
                    cents: Math.round(Number(b.amount) * 100),
                    requestKey: key,
                  });
                  if (result) {
                    setKey(crypto.randomUUID());
                    el.reset();
                  }
                }}
              >
                <h3>RECORD A PAYMENT OR REFUND</h3>
                <label>
                  Booking
                  <select name="bookingId" required>
                    <option value="">Select booking</option>
                    {data.bookings.map((b: Row) => (
                      <option key={b.id} value={b.id}>
                        {b.reference} · {b.name} · {b.currency}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="business-row">
                  <label>
                    Type
                    <select name="kind">
                      <option value="payment">Payment received</option>
                      <option value="refund">Refund paid</option>
                    </select>
                  </label>
                  <label>
                    Amount
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Date
                    <input
                      name="receivedOn"
                      type="date"
                      defaultValue={new Date().toLocaleDateString("en-CA", {
                        timeZone: "America/St_Lucia",
                      })}
                      required
                    />
                  </label>
                  <label>
                    Method
                    <select name="method">
                      <option>Cash</option>
                      <option>Bank transfer</option>
                      <option>Card</option>
                      <option>Other</option>
                    </select>
                  </label>
                </div>
                <label>
                  Reference / note
                  <input name="note" maxLength={500} />
                </label>
                <p className="admin-help">
                  This records money already received or refunded; it does not
                  charge a card. Entries are permanent. Correct mistakes with a
                  matching opposite entry and explanation.
                </p>
                <button disabled={busy} className="primary-action">
                  RECORD TRANSACTION
                </button>
              </form>
              <h3>BOOKING BALANCES · ALL TIME</h3>
              <div className="business-table">
                <table>
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Status</th>
                      <th>Estimate</th>
                      <th>Net paid</th>
                      <th>Estimate remaining</th>
                      <th>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bookings.map((b: Row) => (
                      <tr key={b.id}>
                        <td>
                          {b.reference}
                          <br />
                          {b.name}
                        </td>
                        <td>{b.status}</td>
                        <td>{money(b.estimate, b.currency)}</td>
                        <td>{money(b.paid, b.currency)}</td>
                        <td>{money(b.balance, b.currency)}</td>
                        <td>{money(b.credit, b.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>PAYMENT LEDGER</h3>
              <button onClick={() => downloadCSV(data.ledger)}>
                Download ledger CSV
              </button>
              <div className="business-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Booking</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Method / note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((p: Row) => (
                      <tr key={p.id}>
                        <td>{p.received_on}</td>
                        <td>{p.reference}</td>
                        <td>{p.kind}</td>
                        <td>{money(p.cents, p.currency)}</td>
                        <td>
                          {p.method}
                          <br />
                          {p.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {section === "users" && (
        <>
          <p>
            Staff can manage bookings. Finance access is optional.
            Administrators can manage all sections and permissions. The original
            owner account remains available through server configuration.
          </p>
          <form
            className="business-form"
            onSubmit={async (e) => {
              const el = e.currentTarget,
                b = form(e);
              if (await action("users", { ...b, finance: b.finance === "on" }))
                el.reset();
            }}
          >
            <h3>ADD A TEAM MEMBER</h3>
            <div className="business-row">
              <label>
                Name
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Email (sign-in)
                <input name="email" type="email" required maxLength={254} />
              </label>
              <label>
                Temporary password
                <input
                  name="password"
                  type="password"
                  minLength={16}
                  maxLength={256}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label>
                Role
                <select name="role">
                  <option value="staff">Staff — bookings</option>
                  <option value="admin">Administrator — full access</option>
                </select>
              </label>
            </div>
            <label className="business-check">
              <input name="finance" type="checkbox" />
              Grant staff access to finance
            </label>
            <button disabled={busy} className="primary-action">
              CREATE ACCOUNT
            </button>
            <p className="admin-help">
              Share credentials privately. Account creation does not send an
              email.
            </p>
          </form>
          {data?.map((u: Row) => (
            <UserCard
              key={`${u.id}-${revision}`}
              user={u}
              self={session.id === u.id}
              busy={busy}
              save={(body) => action(`users/${u.id}`, body, "PATCH")}
            />
          ))}
        </>
      )}
      {section === "audience" && (
        <>
          <p>
            Keep permission and source notes with every contact. Booking opt-ins
            can be imported. Unsubscribed contacts remain suppressed.
          </p>
          <button
            disabled={busy}
            onClick={() => action("contacts/import-bookings", {})}
          >
            Import opted-in booking contacts
          </button>
          <form
            className="business-form"
            onSubmit={async (e) => {
              const el = e.currentTarget;
              if (await action("contacts", form(e))) el.reset();
            }}
          >
            <h3>ADD A POTENTIAL CLIENT</h3>
            <div className="business-row">
              <label>
                Name
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Segment
                <input
                  name="segment"
                  placeholder="Hotels, schools, companies…"
                  required
                  maxLength={60}
                />
              </label>
            </div>
            <label>
              Permission / source notes
              <input
                name="basis"
                placeholder="Where this contact came from and permission to email"
                required
                minLength={5}
                maxLength={500}
              />
            </label>
            <button disabled={busy}>SAVE CONTACT</button>
          </form>
          <div className="business-table">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Segment</th>
                  <th>Source</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((c: Row) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      <br />
                      {c.email}
                    </td>
                    <td>{c.segment}</td>
                    <td>{c.basis}</td>
                    <td>
                      {c.subscribed ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            action(`contacts/${c.id}/unsubscribe`, {})
                          }
                        >
                          Unsubscribe
                        </button>
                      ) : (
                        "Unsubscribed"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {section === "email" && (
        <>
          <p>
            Create an introduction or special offer. Use {"{{name}}"} to
            personalise the greeting. Each send uses one recipient per email and
            includes an unsubscribe link.
          </p>
          <EmailComposer busy={busy} save={(b) => action("campaigns", b)} />
          {data?.map((c: Row) => (
            <article className="business-item" key={c.id}>
              <h3>{c.subject}</h3>
              <p className="preserve-lines">{c.body}</p>
              <p>
                Segment: {c.segment || "All subscribed contacts"} · {c.status} ·{" "}
                {c.sent}/{c.recipients} accepted by email server
              </p>
              {c.status === "draft" && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Send “${c.subject}” to subscribed contacts in ${c.segment || "all segments"}?`,
                      )
                    )
                      void action(`campaigns/${c.id}/send`, { confirm: true });
                  }}
                >
                  SEND CAMPAIGN
                </button>
              )}
              <DeliveryLog id={c.id} />
            </article>
          ))}
        </>
      )}
      {section === "connections" && (
        <>
          <p>
            Credentials are configured on your server and never returned to the
            browser. Configured means credentials exist; it does not verify
            provider approval or token validity.
          </p>
          <div className="business-cards">
            {data &&
              Object.entries(data).map(([name, ready]) => (
                <div key={name}>
                  <h3>{name.toUpperCase()}</h3>
                  <strong>{ready ? "Configured" : "Not connected"}</strong>
                  <span>
                    {name === "email"
                      ? "SMTP sender and business address required."
                      : "Official platform account, access token and publishing permissions required."}
                  </span>
                </div>
              ))}
          </div>
          <p>
            Facebook: Page publishing. Instagram: professional account linked to
            a Facebook Page. TikTok: approved Content Posting app and verified
            media domain. YouTube: OAuth upload access; unverified projects may
            be restricted to private uploads.
          </p>
          <p>Setup instructions are in MARKETING_SETUP.md in the repository.</p>
        </>
      )}
      {section === "audit" && (
        <div className="business-table">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Account</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((a: Row) => (
                <tr key={a.id}>
                  <td>{new Date(a.at).toLocaleString()}</td>
                  <td>{a.actor}</td>
                  <td>{a.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!data && section !== "marketing" && !error && (
        <p role="status">Loading…</p>
      )}
    </section>
  );
}
function UserCard({
  user,
  self,
  busy,
  save,
}: {
  user: Row;
  self: boolean;
  busy: boolean;
  save: (b: Row) => Promise<unknown>;
}) {
  return (
    <form
      className="business-item"
      onSubmit={(e) => {
        e.preventDefault();
        const b = Object.fromEntries(new FormData(e.currentTarget));
        void save({
          ...b,
          finance: b.finance === "on",
          active: b.active === "on",
        });
      }}
    >
      <h3>
        {user.name} · {user.email}
      </h3>
      <div className="business-row">
        <label>
          Role
          <select name="role" defaultValue={user.role} disabled={self}>
            <option value="staff">Staff</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <label className="business-check">
          <input
            name="finance"
            type="checkbox"
            defaultChecked={Boolean(user.finance)}
            disabled={self}
          />
          Finance access
        </label>
        <label className="business-check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={Boolean(user.active)}
            disabled={self}
          />
          Account active
        </label>
        <label>
          Reset password (optional)
          <input
            name="password"
            type="password"
            minLength={16}
            maxLength={256}
            autoComplete="new-password"
            disabled={self}
          />
        </label>
      </div>
      <button disabled={busy || self}>SAVE ACCESS & REVOKE SESSIONS</button>
    </form>
  );
}
function EmailComposer({
  busy,
  save,
}: {
  busy: boolean;
  save: (b: Row) => Promise<unknown>;
}) {
  const [media, setMedia] = useState<Row[]>([]);
  useEffect(() => {
    void api<Row[]>("/api/admin/media")
      .then(setMedia)
      .catch(() => {});
  }, []);
  const [subject, setSubject] = useState("Bring your team into the zone"),
    [body, setBody] = useState(
      "Hi {{name}},\n\nMeet CombatZone SLU: mobile laser tag that brings team missions to your venue in Saint Lucia.\n\nPlanning a team day, birthday or community event? Let’s build a game plan together.\n\nExplore the missions and request a booking: " +
        location.origin +
        "/#booking\n\nCombatZone SLU",
    );
  return (
    <form
      className="business-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          subject,
          body,
          segment: new FormData(e.currentTarget).get("segment"),
          mediaId: new FormData(e.currentTarget).get("mediaId"),
        });
      }}
    >
      <div className="business-row">
        <button
          type="button"
          onClick={() => {
            setSubject("Your next squad adventure starts here");
            setBody(
              "Hi {{name}},\n\nReady to rally your squad? [Describe your verified special offer, price and expiry date here.]\n\nRequest your mission: " +
                location.origin +
                "/#booking\n\nSubject to availability.\nCombatZone SLU",
            );
          }}
        >
          Special offer template
        </button>
      </div>
      <label>
        Subject
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={150}
          required
        />
      </label>
      <label>
        Message
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          rows={10}
          required
        />
      </label>
      <label>
        Campaign artwork
        <select name="mediaId">
          <option value="">No image</option>
          {media
            .filter((m) => m.mime === "image/jpeg")
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Segment (blank = all subscribed)
        <input name="segment" maxLength={60} />
      </label>
      <button
        className="primary-action"
        disabled={busy || body.includes("[Describe")}
      >
        SAVE EMAIL DRAFT
      </button>
    </form>
  );
}
function DeliveryLog({ id }: { id: string }) {
  const [rows, setRows] = useState<Row[] | null>(null),
    [error, setError] = useState("");
  return (
    <div>
      <button
        onClick={() =>
          api<Row[]>(`/api/admin/campaigns/${id}/deliveries`)
            .then(setRows)
            .catch((e) => setError(e.message))
        }
      >
        View delivery results
      </button>
      {error && <p role="alert">{error}</p>}
      {rows?.map((r: Row) => (
        <p key={r.email}>
          {r.email} — {r.status} {r.detail}
        </p>
      ))}
    </div>
  );
}
function downloadCSV(rows: Row[]) {
  const columns = [
    "received_on",
    "reference",
    "name",
    "kind",
    "cents",
    "currency",
    "method",
    "note",
  ];
  const escape = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const url = URL.createObjectURL(
    new Blob(
      [
        [
          columns.join(","),
          ...rows.map((r) => columns.map((k) => escape(r[k])).join(",")),
        ].join("\r\n"),
      ],
      { type: "text/csv" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "combatzone-payment-ledger-cents.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
