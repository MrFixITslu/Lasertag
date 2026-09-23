import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { buildDateChoices } from '../src/lib/booking';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

const password = 'test-only-password-long-enough';
const origin = 'http://localhost:5173';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function start(path = ':memory:', secureCookies = false) {
  const { app, db } = createApp({ databasePath: path, adminPassword: password, adminUsername: 'admin', publicOrigin: secureCookies ? 'https://combatzone.example' : origin, secureCookies });
  const server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  let closed = false;
  async function close() { if (!closed) { closed = true; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); } }
  cleanups.push(close);
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method, headers: { Origin: secureCookies ? 'https://combatzone.example' : origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async () => {
    const response = await request('/api/admin/login', 'POST', { username: 'admin', password });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { Cookie: cookie, 'X-CSRF-Token': (await response.json()).csrf };
  };
  return { request, login, close };
}
function draft(overrides: Record<string, unknown> = {}) {
  return { missionId: 'community-festival-play', players: 6, date: buildDateChoices(4)[3].value, time: '09:00', venueType: 'field', area: 'Gros Islet', address: 'Test playing field', notes: 'Test request', weatherFlexible: false, customer: { fullName: 'Test Customer', email: 'customer@example.com', phone: '+17585551234', marketingOptIn: false }, ...overrides };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });
async function createOne(service: Awaited<ReturnType<typeof start>>, body = draft()) {
  const response = await service.request('/api/bookings', 'POST', body, key());
  expect(response.status).toBe(201);
  return response.json();
}

describe('Booking API security and workflows', () => {
  it('requires strong configuration, authentication, origin checks and CSRF; revokes logout sessions', async () => {
    expect(() => createApp({ databasePath: ':memory:', adminUsername: 'admin', adminPassword: 'weak', publicOrigin: origin, secureCookies: false })).toThrow();
    const service = await start();
    expect((await service.request('/api/admin/bookings')).status).toBe(401);
    expect((await service.request('/api/admin/login', 'POST', { username: 'admin', password }, { Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await service.request('/api/admin/login', 'POST', { username: 'admin', password: 'wrong' })).status).toBe(401);
    const auth = await service.login();
    expect((await service.request('/api/admin/bookings', 'GET', undefined, auth)).status).toBe(200);
    expect((await service.request('/api/admin/logout', 'POST', {}, { Cookie: auth.Cookie })).status).toBe(403);
    expect((await service.request('/api/admin/logout', 'POST', {}, auth)).status).toBe(200);
    expect((await service.request('/api/admin/bookings', 'GET', undefined, auth)).status).toBe(401);
  });
  it('uses secure, HttpOnly, SameSite cookies and throttles failed login attempts', async () => {
    const service = await start(':memory:', true);
    const login = await service.request('/api/admin/login', 'POST', { username: 'admin', password });
    expect(login.headers.get('set-cookie')).toContain('Secure');
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('SameSite=Strict');
    for (let i = 0; i < 4; i++) expect((await service.request('/api/admin/login', 'POST', { username: 'admin', password: 'wrong' })).status).toBe(401);
    expect((await service.request('/api/admin/login', 'POST', { username: 'admin', password: 'wrong' })).status).toBe(429);
  });
  it('persists requests, recalculates prices, deduplicates retries and exposes no public customer records', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cz-bookings-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'bookings.sqlite');
    const service = await start(path);
    const requestKey = key();
    const body = draft({ summary: { totalPrice: 1 }, status: 'confirmed', internalNotes: 'injected' });
    const first = await service.request('/api/bookings', 'POST', body, requestKey);
    expect(first.status).toBe(201);
    const receipt = await first.json();
    expect(receipt.status).toBe('pending');
    expect(Object.keys(receipt).sort()).toEqual(['reference', 'status']);
    const repeated = await service.request('/api/bookings', 'POST', body, requestKey);
    expect((await repeated.json()).reference).toBe(receipt.reference);
    expect((await service.request('/api/bookings', 'POST', draft({ players: 12 }), requestKey)).status).toBe(409);
    const auth = await service.login();
    const list = await (await service.request('/api/admin/bookings', 'GET', undefined, auth)).json();
    expect(list.total).toBe(1);
    const item = await (await service.request(`/api/admin/bookings/${list.bookings[0].id}`, 'GET', undefined, auth)).json();
    expect(item.summary.totalPrice).toBe(120);
    expect(item.summary.baseDurationMinutes).toBe(15);
    expect(item.internalNotes).toBe('');
    expect((await service.request(`/api/bookings/${item.id}`)).status).toBe(404);
    expect((await service.request(`/api/admin/bookings/${item.id}`)).status).toBe(401);
    await service.close();
    const restarted = await start(path);
    expect((await restarted.request('/api/admin/session', 'GET', undefined, auth)).status).toBe(401);
    const newAuth = await restarted.login();
    const persisted = await (await restarted.request('/api/admin/bookings', 'GET', undefined, newAuth)).json();
    expect(persisted.total).toBe(1); expect(persisted.bookings[0].reference).toBe(receipt.reference);
  });
  it('rejects invalid customers, dates, times and player counts', async () => {
    const service = await start();
    for (const body of [draft({ players: -1 }), draft({ players: 6.5 }), draft({ players: 61 }), draft({ missionId: 'fake' }), draft({ date: '2020-01-01' }), draft({ time: '23:00' }), draft({ customer: null }), draft({ weatherFlexible: 'false' }), draft({ address: '' })]) {
      expect((await service.request('/api/bookings', 'POST', body, key())).status).toBe(400);
    }
  });
  it('guards confirmations against overlap and stale edits, records history, and supports filters', async () => {
    const service = await start();
    await createOne(service); await createOne(service, draft({ time: '10:00' }));
    const auth = await service.login();
    const list = await (await service.request('/api/admin/bookings', 'GET', undefined, auth)).json();
    const [one, two] = list.bookings;
    const update = (id: string, fields: Record<string, unknown>) => service.request(`/api/admin/bookings/${id}`, 'PATCH', { status: 'confirmed', date: one.date, time: '09:00', internalNotes: 'Private setup note', version: 1, ...fields }, auth);
    const confirmed = await update(one.id, {});
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).history[0].message).toContain('confirmed');
    expect((await update(one.id, { internalNotes: 'Stale overwrite' })).status).toBe(409);
    expect((await update(two.id, { time: '10:00' })).status).toBe(409); // 15 minutes plus 60 minute buffer overlaps.
    expect((await update(two.id, { time: '11:00' })).status).toBe(200);
    expect((await update(one.id, { status: 'completed', version: 2 })).status).toBe(400);
    const filtered = await (await service.request(`/api/admin/bookings?status=confirmed&q=${one.reference}`, 'GET', undefined, auth)).json();
    expect(filtered.total).toBe(1);
    expect((await update(one.id, { status: 'cancelled', version: 2 })).status).toBe(200);
    const rebook = await update(two.id, { time: '09:00', version: 2 });
    expect(rebook.status).toBe(200);
    const final = await rebook.json();
    expect(final.draft.time).toBe('09:00'); expect(final.history).toHaveLength(3);
  });
});
