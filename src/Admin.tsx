import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ClipboardList, LogOut, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import Brand from './Brand';
import { api, ApiError } from './lib/api';
import { buildDateChoices, fixedStartTimes, formatDuration, formatTime } from './lib/booking';
import type { BookingDraft, BookingSummary, MissionPackage } from './types';
import './admin.css';

type Status = 'pending' | 'confirmed' | 'completed' | 'cancelled';
const statuses: Status[] = ['pending', 'confirmed', 'completed', 'cancelled'];
const labels: Record<Status, string> = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
interface Session { username: string; csrf: string; }
interface BookingRow { id: string; reference: string; date: string; time: string; status: Status; name: string; mission: string; players: number; area: string; }
interface BookingDetail { id: string; reference: string; status: Status; version: number; createdAt: string; updatedAt: string; draft: BookingDraft; mission: MissionPackage; summary: BookingSummary; internalNotes: string; history: { at: string; actor: string; message: string }[]; }
interface List { bookings: BookingRow[]; total: number; page: number; counts: Partial<Record<Status, number>>; }
interface Edit { status: Status; date: string; time: string; internalNotes: string; }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unable to connect. Please try again.';
const dateLabel = (date: string) => new Date(`${date}T12:00:00-04:00`).toLocaleDateString('en-GB', { timeZone: 'America/St_Lucia', day: 'numeric', month: 'short', year: 'numeric' });
const timestamp = (date: string) => new Date(date).toLocaleString('en-GB', { timeZone: 'America/St_Lucia', dateStyle: 'medium', timeStyle: 'short' });

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const dirty = Boolean(detail && edit && (detail.status !== edit.status || detail.draft.date !== edit.date || detail.draft.time !== edit.time || detail.internalNotes !== edit.internalNotes));

  function handleError(err: unknown) {
    setError(errorMessage(err));
    if (err instanceof ApiError && err.status === 401) { setSession(null); setList(null); setDetail(null); setEdit(null); setSelected(''); }
  }
  useEffect(() => {
    document.title = 'CombatZone SLU — Booking Control';
    const controller = new AbortController();
    api<Session>('/api/admin/session', { signal: controller.signal }).then(setSession).catch(err => {
      if (!controller.signal.aborted && !(err instanceof ApiError && err.status === 401)) setError(errorMessage(err));
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ q: query, status, date, page: String(page) });
    api<List>(`/api/admin/bookings?${params}`, { signal: controller.signal }).then(setList).catch(err => {
      if (!controller.signal.aborted) { setList(null); handleError(err); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, query, status, date, page, revision]);
  useEffect(() => {
    if (!session || !selected) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetail(null); setEdit(null);
    api<BookingDetail>(`/api/admin/bookings/${selected}`, { signal: controller.signal }).then(value => {
      setDetail(value); setEdit({ status: value.status, date: value.draft.date, time: value.draft.time, internalNotes: value.internalNotes });
    }).catch(err => { if (!controller.signal.aborted) handleError(err); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [session, selected, detailRevision]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { setSession(await api<Session>('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) })); setPassword(''); }
    catch (err) { handleError(err); setPassword(''); }
    finally { setBusy(false); }
  }
  async function signOut() {
    if (dirty && !window.confirm('Discard unsaved changes and sign out?')) return;
    setBusy(true); setError('');
    try { await api('/api/admin/logout', { method: 'POST', headers: { 'X-CSRF-Token': session!.csrf }, body: '{}' }); setSession(null); setList(null); setDetail(null); setEdit(null); setSelected(''); setNotice('Signed out.'); }
    catch (err) { handleError(err); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!detail || !edit || !session) return;
    if (edit.status === 'cancelled' && detail.status !== 'cancelled' && !window.confirm(`Cancel booking ${detail.reference}? The record will be retained.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await api<BookingDetail>(`/api/admin/bookings/${detail.id}`, { method: 'PATCH', headers: { 'X-CSRF-Token': session.csrf }, body: JSON.stringify({ ...edit, version: detail.version }) });
      setDetail(updated); setEdit({ status: updated.status, date: updated.draft.date, time: updated.draft.time, internalNotes: updated.internalNotes }); setRevision(value => value + 1); setNotice('Booking updated. Contact the customer separately to communicate changes.');
    } catch (err) { handleError(err); }
    finally { setBusy(false); }
  }
  function choose(id: string) {
    if (dirty && !window.confirm('Discard unsaved changes and open this booking?')) return;
    setSelected(id); setNotice(''); setError('');
  }
  function reloadDetail() {
    if (dirty && !window.confirm('Discard your unsaved changes and reload the latest booking?')) return;
    setDetailRevision(value => value + 1); setError('');
  }
  const updateEdit = <K extends keyof Edit>(key: K, value: Edit[K]) => setEdit(current => current ? { ...current, [key]: value } : null);

  return (
    <div className="app-shell admin-shell">
      <header className="topbar"><Brand href="/" /><div className="admin-top-actions"><a href="/#booking" target="_blank" rel="noreferrer">New request ↗</a>{session && <button onClick={signOut} disabled={busy}><LogOut size={16} /> Sign out</button>}</div></header>
      <main className="admin-main">
        <div className="admin-title"><div><p className="eyebrow"><ShieldCheck size={15} /> PRIVATE OPERATIONS / ADMIN</p><h1>BOOKING CONTROL.</h1></div>{session && <p>Signed in as <strong>{session.username}</strong><br />All event times: Saint Lucia (UTC−4)</p>}</div>
        {error && <div className="admin-message admin-error" role="alert">{error}</div>}
        {notice && <div className="admin-message" role="status"><Check size={16} />{notice}</div>}
        {checking ? <p role="status">Checking your session…</p> : !session ? (
          <form className="admin-login hud-panel" onSubmit={signIn}><ShieldCheck size={30} /><h2>ADMIN SIGN IN</h2><p>Manage requests, deployment schedules and internal notes.</p><label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} maxLength={80} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={256} required /></label><button className="primary-action" disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</button></form>
        ) : <>
          <div className="admin-stats">{statuses.map(item => <button key={item} className={status === item ? 'selected' : ''} onClick={() => { setStatus(status === item ? '' : item); setPage(1); }} aria-pressed={status === item}><span>{labels[item]}</span><strong>{list ? (list.counts[item] ?? 0) : '—'}</strong></button>)}</div>
          <form className="admin-filters" onSubmit={event => { event.preventDefault(); setQuery(search); setPage(1); }}><label>Search requests<div className="admin-search"><Search size={17} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email or reference" maxLength={120} /></div></label><label>Status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map(item => <option key={item} value={item}>{labels[item]}</option>)}</select></label><label>Event date<input type="date" value={date} onChange={event => { setDate(event.target.value); setPage(1); }} /></label><button className="primary-action" disabled={loading}>SEARCH</button><button type="button" className="secondary-action" disabled={loading} onClick={() => { setSearch(''); setQuery(''); setStatus(''); setDate(''); setPage(1); setRevision(value => value + 1); }}>RESET</button><button type="button" className="admin-icon-button" onClick={() => setRevision(value => value + 1)} disabled={loading} aria-label="Refresh booking list"><RefreshCw size={18} /></button></form>
          <div className="admin-workspace">
            <section className="admin-list hud-panel" aria-label="Booking requests" aria-busy={loading}>
              <div className="admin-panel-header"><span><ClipboardList size={16} /> REQUESTS {list ? `(${list.total})` : ''}</span>{loading && <small role="status">Loading…</small>}</div>
              {!loading && list?.bookings.length === 0 && <div className="admin-empty"><CalendarDays size={32} /><h2>No requests found</h2><p>New submissions will appear here. Try clearing your filters.</p></div>}
              {list?.bookings.map(item => <button disabled={busy || loading} key={item.id} onClick={() => choose(item.id)} className={`admin-booking-row ${selected === item.id ? 'selected' : ''}`} aria-pressed={selected === item.id}><div><small>{item.reference}</small><span className={`admin-badge ${item.status}`}>{labels[item.status]}</span></div><h3>{item.name}</h3><p>{item.mission}</p><div className="admin-row-meta"><span><CalendarDays size={13} />{dateLabel(item.date)} · {formatTime(item.time)}</span><span><Users size={13} />{item.players}</span></div><small>{item.area}</small></button>)}
              {list && list.total > 25 && <div className="admin-pagination"><button className="secondary-action" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page} / {Math.ceil(list.total / 25)}</span><button className="secondary-action" disabled={loading || page * 25 >= list.total} onClick={() => setPage(value => value + 1)}>Next</button></div>}
            </section>
            <section className="admin-detail hud-panel" aria-label="Selected booking details" aria-busy={detailLoading}>
              {detailLoading ? <p role="status">Loading booking…</p> : detail && edit ? <>
                <div className="admin-panel-header"><span>{detail.reference}</span><button className="admin-text-button" disabled={busy} onClick={reloadDetail}><RefreshCw size={14} /> Reload</button></div>
                <h2>{detail.mission.name}</h2><span className={`admin-badge ${detail.status}`}>{labels[detail.status]}</span>
                <dl className="admin-facts"><div><dt>Customer</dt><dd>{detail.draft.customer.fullName}</dd></div><div><dt>Email</dt><dd><a href={`mailto:${detail.draft.customer.email}`}>{detail.draft.customer.email}</a></dd></div><div><dt>Phone</dt><dd><a href={`tel:${detail.draft.customer.phone.replace(/[^+\d]/g, '')}`}>{detail.draft.customer.phone}</a></dd></div><div><dt>Players</dt><dd>{detail.draft.players} · {detail.summary.squadCount} squads</dd></div><div><dt>Venue</dt><dd>{detail.draft.venueType} · {detail.draft.area}<br />{detail.draft.address}</dd></div><div><dt>Play / block</dt><dd>{formatDuration(detail.summary.totalMissionMinutes)} play · {formatDuration(detail.summary.totalBlockMinutes)} including buffer</dd></div><div><dt>Estimate</dt><dd>{detail.summary.currency} {detail.summary.totalPrice.toFixed(2)} · payment not collected</dd></div><div><dt>Weather</dt><dd>{detail.draft.weatherFlexible ? 'Light rain accepted if safe' : 'Dry-weather preference'}</dd></div><div><dt>Marketing</dt><dd>{detail.draft.customer.marketingOptIn ? 'Opted in' : 'Not opted in'}</dd></div><div><dt>Received</dt><dd>{timestamp(detail.createdAt)}</dd></div></dl>
                {detail.draft.notes && <div className="admin-customer-notes"><h3>CUSTOMER NOTES</h3><p>{detail.draft.notes}</p></div>}
                <form onSubmit={save} className="admin-edit"><h3>MANAGE REQUEST</h3><div className="admin-edit-grid"><label>Status<select value={edit.status} disabled={busy} onChange={event => updateEdit('status', event.target.value as Status)}>{statuses.map(item => <option key={item} value={item}>{labels[item]}</option>)}</select></label><label>Event date<input type="date" required max={buildDateChoices(365)[364].value} value={edit.date} disabled={busy} onChange={event => updateEdit('date', event.target.value)} /></label><label>Start time<select value={edit.time} disabled={busy} onChange={event => updateEdit('time', event.target.value)}>{fixedStartTimes.map(time => <option key={time} value={time}>{formatTime(time)}</option>)}</select></label></div><label>Internal notes<textarea rows={4} maxLength={5000} value={edit.internalNotes} disabled={busy} onChange={event => updateEdit('internalNotes', event.target.value)} placeholder="Setup arrangements, customer calls, team assignments…" /></label><p className="admin-help">Confirmation checks other confirmed events, including the operating buffer. Changes do not send email or collect payment.</p><button className="primary-action" disabled={busy || !dirty}>{busy ? 'SAVING…' : 'SAVE CHANGES'}</button>{dirty && <span className="admin-unsaved">Unsaved changes</span>}</form>
                <div className="admin-history"><h3>ACTIVITY HISTORY</h3><ol>{detail.history.map((item, index) => <li key={`${item.at}-${index}`}><p>{item.message}</p><small>{timestamp(item.at)} · {item.actor}</small></li>)}</ol></div>
              </> : <div className="admin-empty"><ClipboardList size={36} /><h2>Select a booking</h2><p>Review customer details, manage the schedule and keep your team’s notes in one place.</p>{selected && <button className="secondary-action" onClick={reloadDetail}>Retry loading</button>}</div>}
            </section>
          </div>
        </>}
        <a className="admin-back" href="/"><ArrowLeft size={15} /> Back to CombatZone SLU</a>
      </main>
    </div>
  );
}
