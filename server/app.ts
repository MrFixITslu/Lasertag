import express, { type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scryptSync, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { missions } from '../src/data/missions';
import { buildDateChoices, calculateBookingSummary, fixedStartTimes, validCustomer } from '../src/lib/booking';
import type { BookingDraft } from '../src/types';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
const statuses = ['pending', 'confirmed', 'completed', 'cancelled'];
const cookieName = 'cz_admin';
const sessionLifetime = 8 * 60 * 60 * 1000;
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function text(value: unknown, name: string, max: number, min = 0) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `Check ${name}.`);
  return (value as string).trim();
}
function schedule(date: unknown, time: unknown, futureOnly = true) {
  const day = text(date, 'date', 10, 10);
  const hour = text(time, 'start time', 5, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !fixedStartTimes.includes(hour as typeof fixedStartTimes[number])) fail(400, 'Choose a valid date and start time.');
  const timestamp = Date.parse(`${day}T${hour}:00-04:00`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) fail(400, 'Choose a valid calendar date.');
  if (futureOnly && (day < buildDateChoices(1)[0].value || day > buildDateChoices(365)[364].value)) fail(400, 'Choose a date from tomorrow through the next 365 days.');
  return { date: day, time: hour, timestamp };
}
function validateDraft(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid booking request.');
  const body = input as Record<string, unknown>;
  const mission = missions.find(item => item.id === body.missionId);
  if (!mission) fail(400, 'Choose a valid mission.');
  const players = body.players;
  if (typeof players !== 'number' || !Number.isInteger(players) || players < mission.minPlayers || players > 60) fail(400, 'Choose between 6 and 60 players.');
  const slot = schedule(body.date, body.time);
  const venues = ['home', 'field', 'community', 'hotel', 'event', 'other'];
  if (typeof body.venueType !== 'string' || !venues.includes(body.venueType)) fail(400, 'Choose a venue type.');
  const person = body.customer as Record<string, unknown> | undefined;
  if (!person || typeof person !== 'object' || Array.isArray(person)) fail(400, 'Enter contact details.');
  if (typeof body.weatherFlexible !== 'boolean' || typeof person.marketingOptIn !== 'boolean') fail(400, 'Invalid preference selection.');
  const customer = { fullName: text(person.fullName, 'full name', 120, 2), email: text(person.email, 'email', 254, 3), phone: text(person.phone, 'phone', 30, 7), marketingOptIn: person.marketingOptIn };
  if (!validCustomer(customer)) fail(400, 'Enter a valid name, email and phone number.');
  const draft: BookingDraft = { missionId: mission.id, players, date: slot.date, time: slot.time, venueType: body.venueType, area: text(body.area, 'area', 120, 2), address: text(body.address, 'address', 500, 3), notes: text(body.notes ?? '', 'notes', 2000), weatherFlexible: body.weatherFlexible, customer };
  return { draft, mission, summary: calculateBookingSummary(mission, players) };
}
type Row = Record<string, any>;
export interface ServerConfig { databasePath: string; adminUsername: string; adminPassword: string; publicOrigin: string; secureCookies: boolean; trustProxy?: number; staticPath?: string; }

export function createApp(config: ServerConfig) {
  if (config.adminPassword.length < 16 || config.adminPassword.length > 256) throw new Error('ADMIN_PASSWORD must contain 16–256 characters.');
  if (!config.adminUsername || config.adminUsername.length > 80) throw new Error('ADMIN_USERNAME is required (maximum 80 characters).');
  const origin = new URL(config.publicOrigin).origin;
  if (config.secureCookies && !origin.startsWith('https://')) throw new Error('PUBLIC_ORIGIN must use HTTPS when secure cookies are enabled.');
  if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(status IN ('pending','confirmed','completed','cancelled')),
      date TEXT NOT NULL, time TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
      name TEXT NOT NULL, email TEXT NOT NULL, payload TEXT NOT NULL, internal_notes TEXT NOT NULL DEFAULT '',
      request_key TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookings_status_date ON bookings(status,date);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), at TEXT NOT NULL, actor TEXT NOT NULL, message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
  `);
  // Restarting or rotating credentials revokes all existing admin sessions.
  db.exec('DELETE FROM sessions');
  const salt = randomBytes(32);
  const passwordHash = scryptSync(config.adminPassword, salt, 64);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? 0);
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" });
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('Origin') !== origin) return next(new ApiError(403, 'Request origin is not allowed.'));
      if (!req.is('application/json')) return next(new ApiError(415, 'Use application/json.'));
    }
    next();
  });
  app.use(express.json({ limit: '20kb' }));
  const cookieOptions = { httpOnly: true, secure: config.secureCookies, sameSite: 'strict' as const, path: '/api/admin' };
  function token(req: Request) { return (req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? ''; }
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const session = db.prepare('SELECT csrf, expires FROM sessions WHERE token_hash=?').get(digest(token(req))) as Row | undefined;
    if (!session || session.expires <= Date.now()) return next(new ApiError(401, 'Please sign in again.'));
    res.locals.csrf = session.csrf;
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-CSRF-Token') !== session.csrf) return next(new ApiError(403, 'Session verification failed. Refresh and try again.'));
    next();
  };
  const limiter = (limit: number, windowMs: number) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });
  app.post('/api/admin/login', limiter(5, 15 * 60_000), async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    if (password.length > 256 || username.length > 80) fail(401, 'Incorrect username or password.');
    const candidate = await derive(password, salt, 64) as Buffer;
    if (!timingSafeEqual(candidate, passwordHash) || username !== config.adminUsername) fail(401, 'Incorrect username or password.');
    db.prepare('DELETE FROM sessions WHERE expires <= ? OR token_hash=?').run(Date.now(), digest(token(req)));
    const sessionToken = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(sessionToken), csrf, Date.now() + sessionLifetime);
    res.cookie(cookieName, sessionToken, { ...cookieOptions, maxAge: sessionLifetime }).json({ username: config.adminUsername, csrf });
  });
  app.use('/api/admin', authenticate);
  app.get('/api/admin/session', (_req, res) => res.json({ username: config.adminUsername, csrf: res.locals.csrf }));
  app.post('/api/admin/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token(req)));
    res.clearCookie(cookieName, cookieOptions).json({ ok: true });
  });
  app.post('/api/bookings', limiter(15, 60 * 60_000), (req, res) => {
    const key = req.get('Idempotency-Key') ?? '';
    if (!/^[a-f0-9-]{36}$/i.test(key)) fail(400, 'Missing request identifier. Refresh and try again.');
    const booking = validateDraft(req.body);
    const hash = digest(JSON.stringify(booking.draft));
    const existing = db.prepare('SELECT reference,request_hash FROM bookings WHERE request_key=?').get(key) as Row | undefined;
    if (existing) {
      if (existing.request_hash !== hash) fail(409, 'This request identifier was already used. Refresh before submitting a different request.');
      return res.json({ reference: existing.reference, status: 'pending' });
    }
    const id = randomUUID();
    const reference = `CZ-${randomBytes(6).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const start = schedule(booking.draft.date, booking.draft.time).timestamp;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO bookings (id,reference,created_at,updated_at,status,date,time,start_ms,end_ms,name,email,payload,request_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, reference, now, now, 'pending', booking.draft.date, booking.draft.time, start, start + booking.summary.totalBlockMinutes * 60_000, booking.draft.customer.fullName, booking.draft.customer.email, JSON.stringify(booking), key, hash);
      db.prepare('INSERT INTO history (booking_id,at,actor,message) VALUES (?,?,?,?)').run(id, now, 'Customer', 'Booking request received.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.status(201).json({ reference, status: 'pending' });
  });
  const getBooking = (id: string) => {
    const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(id) as Row | undefined;
    if (!row) fail(404, 'Booking not found.');
    return row;
  };
  const detail = (row: Row) => ({ id: row.id, reference: row.reference, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version, status: row.status, internalNotes: row.internal_notes, ...JSON.parse(row.payload), history: db.prepare('SELECT at,actor,message FROM history WHERE booking_id=? ORDER BY id DESC').all(row.id) });
  app.get('/api/admin/bookings', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120).toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    if (status && !statuses.includes(status)) fail(400, 'Invalid status filter.');
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Invalid date filter.');
    const page = Math.min(100000, Math.max(1, parseInt(String(req.query.page), 10) || 1));
    const conditions = "(?='' OR status=?) AND (?='' OR date=?) AND (?='' OR instr(lower(name || ' ' || email || ' ' || reference),?)>0)";
    const params = [status, status, date, date, q, q];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE ${conditions}`).get(...params) as Row).n;
    const rows = db.prepare(`SELECT * FROM bookings WHERE ${conditions} ORDER BY date,time,created_at LIMIT 25 OFFSET ?`).all(...params, (page - 1) * 25) as Row[];
    const counts = Object.fromEntries(db.prepare('SELECT status,COUNT(*) AS n FROM bookings GROUP BY status').all().map(row => [row.status, row.n]));
    res.json({ total, page, counts, bookings: rows.map(row => { const payload = JSON.parse(row.payload); return { id: row.id, reference: row.reference, date: row.date, time: row.time, status: row.status, name: row.name, mission: payload.mission.name, players: payload.draft.players, area: payload.draft.area }; }) });
  });
  app.get('/api/admin/bookings/:id', (req, res) => res.json(detail(getBooking(String(req.params.id)))));
  app.patch('/api/admin/bookings/:id', (req, res) => {
    const id = String(req.params.id);
    if (!req.body || typeof req.body !== 'object') fail(400, 'Invalid update.');
    const { status, version } = req.body;
    if (!statuses.includes(status) || !Number.isInteger(version)) fail(400, 'Choose a valid status.');
    const notes = text(req.body.internalNotes, 'internal notes', 5000);
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = getBooking(id);
      if (row.version !== version) fail(409, 'This booking changed in another session. Reload it before saving.');
      const payload = JSON.parse(row.payload);
      const changedSchedule = req.body.date !== row.date || req.body.time !== row.time;
      const slot = schedule(req.body.date, req.body.time, changedSchedule);
      if (status === 'confirmed' && slot.timestamp < Date.now()) fail(400, 'A past event cannot be confirmed. Reschedule it first.');
      if (status === 'completed' && slot.timestamp > Date.now()) fail(400, 'A future event cannot be marked completed.');
      const end = slot.timestamp + payload.summary.totalBlockMinutes * 60_000;
      if (status === 'confirmed') {
        const conflict = db.prepare("SELECT reference FROM bookings WHERE id<>? AND status='confirmed' AND start_ms < ? AND end_ms > ? LIMIT 1").get(id, end, slot.timestamp) as Row | undefined;
        if (conflict) fail(409, `Overlaps confirmed booking ${conflict.reference}, including its operating buffer. Choose another time.`);
      }
      payload.draft.date = slot.date; payload.draft.time = slot.time;
      const now = new Date().toISOString();
      db.prepare('UPDATE bookings SET status=?,date=?,time=?,start_ms=?,end_ms=?,payload=?,internal_notes=?,updated_at=?,version=version+1 WHERE id=?').run(status, slot.date, slot.time, slot.timestamp, end, JSON.stringify(payload), notes, now, id);
      const changes = [status !== row.status ? `Status: ${row.status} → ${status}.` : '', changedSchedule ? `Schedule: ${row.date} ${row.time} → ${slot.date} ${slot.time} (Saint Lucia).` : '', notes !== row.internal_notes ? 'Internal notes updated.' : ''].filter(Boolean).join(' ') || 'Booking reviewed.';
      db.prepare('INSERT INTO history (booking_id,at,actor,message) VALUES (?,?,?,?)').run(id, now, config.adminUsername, changes);
      db.exec('COMMIT');
      res.json(detail(getBooking(id)));
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  app.get('/health', (_req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok\n'); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const staticPath = resolve(config.staticPath ?? 'dist');
  app.use(express.static(staticPath, { index: false, dotfiles: 'deny', maxAge: '1h' }));
  app.get(['/', '/admin', '/admin/'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/admin')) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(resolve(staticPath, 'index.html'));
  });
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof ApiError ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: error instanceof ApiError ? error.message : status === 413 ? 'Request is too large.' : status === 400 ? 'Invalid JSON request.' : 'Unable to complete the request. Please try again.' });
  });
  return { app, db };
}
