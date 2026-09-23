import { useEffect, useState } from "react";
import { api } from "./lib/api";
import type { AdminSession } from "./BusinessConsole";
type Row = Record<string, any>;
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/St_Lucia" });
export default function Kpis({ session }: { session: AdminSession }) {
  const [from, setFrom] = useState(today().slice(0, 8) + "01"),
    [to, setTo] = useState(today()),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api<Row>(`/api/admin/kpis?from=${from}&to=${to}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [from, to, revision]);
  const csv = () => {
    if (!data) return;
    const rows = [
      ...data.operations.cards.map((c: Row) => ({ ...c, section: "Bookings" })),
      ...(data.finance || []).flatMap((f: Row) =>
        f.cards.map((c: Row) => ({ ...c, section: "Finance " + f.currency })),
      ),
      ...(data.marketing?.cards || []).map((c: Row) => ({
        ...c,
        section: "Marketing",
      })),
    ];
    const keys = ["section", "label", "value", "previous", "unit", "detail"];
    const cell = (v: any) =>
      '"' + String(v ?? "Not measured").replaceAll('"', '""') + '"';
    const blob = new Blob(
      [
        [
          keys.join(","),
          ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
        ].join("\r\n"),
      ],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `combatzone-kpis-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="business-panel hud-panel">
      <div className="business-heading">
        <div>
          <p className="eyebrow">MEASURE THE MISSION</p>
          <h2>PERFORMANCE INTELLIGENCE.</h2>
          <p>
            Bookings, cash and campaigns — measured separately, with the right
            access.
          </p>
        </div>
        <button disabled={!data} onClick={csv}>
          EXPORT KPI CSV
        </button>
      </div>
      <div className="business-row">
        <label>
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            min={from}
            max={today()}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button onClick={() => setRevision((v) => v + 1)}>REFRESH</button>
        <button
          onClick={() => {
            setFrom(
              new Date(Date.parse(today()) - 29 * 86400000)
                .toISOString()
                .slice(0, 10),
            );
            setTo(today());
          }}
        >
          LAST 30 DAYS
        </button>
      </div>
      {error && (
        <p role="alert" className="admin-message admin-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading performance…</p>}
      {data && (
        <>
          <p className="admin-help">
            Comparison: {data.beforeFrom} to {data.beforeTo}. Event dates and
            reporting days use Saint Lucia time. Status-based metrics describe
            the current status of each request cohort. “Snapshot” cards are
            current totals and have no period comparison.
          </p>
          <h3>BOOKING OPERATIONS</h3>
          <Metrics cards={data.operations.cards} targets={data.targets} />
          <h3>REQUEST TREND</h3>
          <div className="kpi-trend" aria-label="Daily booking requests">
            {data.operations.trend.map((d: Row) => (
              <div key={d.day} title={`${d.day}: ${d.requests} requests`}>
                <span>{d.requests || ""}</span>
                <i
                  style={{
                    height: Math.max(
                      3,
                      (120 * d.requests) /
                        Math.max(
                          1,
                          ...data.operations.trend.map((x: Row) => x.requests),
                        ),
                    ),
                  }}
                />
                <small>{d.day.slice(5)}</small>
              </div>
            ))}
          </div>
          <div className="studio-layout">
            <Breakdown title="MISSION DEMAND" rows={data.operations.missions} />
            <Breakdown title="DEMAND BY AREA" rows={data.operations.areas} />
          </div>
          {data.finance && (
            <>
              <h3>FINANCIAL PERFORMANCE</h3>
              <p>
                Money cards use the booking currency without currency
                conversion. CSV money values are integer cents. Cash received is
                not a profit calculation.
              </p>
              {data.finance.length ? (
                data.finance.map((f: Row) => (
                  <div key={f.currency}>
                    <h3>{f.currency}</h3>
                    <Metrics cards={f.cards} currency={f.currency} />
                  </div>
                ))
              ) : (
                <p>No bookings yet.</p>
              )}
            </>
          )}
          {data.marketing && (
            <>
              <h3>MARKETING PERFORMANCE</h3>
              <p>
                Web tracking began{" "}
                {new Date(data.trackingStarted).toLocaleDateString("en-GB")}.
                Earlier periods are incomplete. Do Not Track, opt-outs, blocked
                scripts and direct visits affect web measurements.
              </p>
              <Metrics cards={data.marketing.cards} targets={data.targets} />
              <details className="business-item">
                <summary>Metrics that need more source data</summary>
                <ul>
                  {data.marketing.unavailable.map((s: string) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
          {session.role === "admin" && (
            <form
              className="business-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                const f = new FormData(e.currentTarget);
                try {
                  await api("/api/admin/kpi-targets", {
                    method: "PUT",
                    headers: { "X-CSRF-Token": session.csrf },
                    body: JSON.stringify({
                      key: f.get("key"),
                      value: Number(f.get("value")),
                    }),
                  });
                  setRevision((v) => v + 1);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <h3>SET A PERFORMANCE TARGET</h3>
              <p>
                Targets apply to the selected reporting period. Set
                request-count targets for the period length you use; percentage
                and response-time targets are independent of period length.
              </p>
              <div className="business-row">
                <label>
                  KPI
                  <select name="key">
                    <option value="requests">Booking requests (minimum)</option>
                    <option value="confirmationRate">
                      Confirmation rate % (minimum)
                    </option>
                    <option value="cancellationRate">
                      Cancellation rate % (maximum)
                    </option>
                    <option value="responseHours">
                      First staff action hours (maximum)
                    </option>
                    <option value="repeatRate">
                      Repeat request rate % (minimum)
                    </option>
                    <option value="conversionRate">
                      Tracked conversion rate % (minimum)
                    </option>
                  </select>
                </label>
                <label>
                  Target
                  <input
                    type="number"
                    name="value"
                    min="0"
                    max="100000"
                    step="0.1"
                    required
                  />
                </label>
                <button disabled={saving}>SAVE TARGET</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
function Metrics({
  cards,
  currency,
  targets = {},
}: {
  cards: Row[];
  currency?: string;
  targets?: Row;
}) {
  return (
    <div className="business-cards kpi-cards">
      {cards.map((c) => {
        const format = (v: number | null) =>
          v === null
            ? "Not measured"
            : c.unit === "money"
              ? new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency,
                }).format(v / 100)
              : `${Number.isInteger(v) ? v : v.toFixed(1)}${c.unit === "percent" ? "%" : c.unit === "hours" ? " h" : ""}`;
        const hasTarget = targets[c.id] !== undefined;
        const good =
          c.value !== null &&
          (["cancellationRate", "responseHours"].includes(c.id)
            ? c.value <= targets[c.id]
            : c.value >= targets[c.id]);
        return (
          <div key={c.id}>
            <small>{c.label}</small>
            <strong>{format(c.value)}</strong>
            {c.previous !== null && (
              <span>
                Previous: {format(c.previous)}
                {c.value !== null && c.previous !== 0
                  ? ` · ${(((c.value - c.previous) / Math.abs(c.previous)) * 100).toFixed(1)}% change`
                  : ""}
              </span>
            )}
            {hasTarget && (
              <span className={good ? "kpi-on-target" : "kpi-off-target"}>
                {c.value === null
                  ? "Not measured"
                  : good
                    ? "On target"
                    : "Outside target"}{" "}
                · target {format(targets[c.id])}
              </span>
            )}
            <span>{c.detail}</span>
          </div>
        );
      })}
    </div>
  );
}
function Breakdown({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="business-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>No requests in this period.</p>}
      </div>
    </div>
  );
}
