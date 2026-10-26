import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import postgres from 'postgres';
import { exchangeGroupCode, requireGuest } from '@/features/access/service';
import { consumeRateLimit } from '@/features/access/rate-limit';
import { assertSameOrigin, accessRateLimitKey, guestCookieSecure } from '@/lib/http';
import { seedGuestSession, testDatabaseUrl, withTestAdmin, withTestDb } from '../helpers/database';

const origin = process.env.TEST_APP_ORIGIN!;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/access`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'manual' });

test('only live, unrevoked sessions for an active group authorize', async () => {
  await withTestDb(async db => {
    for (const cookie of [undefined, 'forged', 'a'.repeat(43)]) await expect(requireGuest(cookie, db)).rejects.toMatchObject({ status: 401 });
    const guest = await seedGuestSession('group-2', db);
    expect((await requireGuest(guest.cookie, db)).groupId).toBe('group-2');
    const [stored] = await db`select * from wedding.guest_sessions where id=${guest.actor.sessionId}`;
    expect(stored.token_hash).toBe(hash(guest.cookie));
    expect(JSON.stringify(stored)).not.toContain(guest.cookie);
    await db`update wedding.guest_sessions set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=${guest.actor.sessionId}`;
    await expect(requireGuest(guest.cookie, db)).rejects.toMatchObject({ status: 401 });
    const revoked = await seedGuestSession('group-1', db);
    await db`update wedding.guest_sessions set revoked_at=now() where id=${revoked.actor.sessionId}`;
    await expect(requireGuest(revoked.cookie, db)).rejects.toMatchObject({ status: 401 });
    const rotated = await seedGuestSession('group-1', db);
    await db`update wedding.invitation_groups set rotated_at=clock_timestamp() where id='group-1'`;
    await expect(requireGuest(rotated.cookie, db)).rejects.toMatchObject({ status: 401 });
    const disabled = await seedGuestSession('group-2', db);
    await db`update wedding.invitation_groups set code_hash=null where id='group-2'`;
    await expect(requireGuest(disabled.cookie, db)).rejects.toMatchObject({ status: 401 });
  });
});

test('exchange creates independent opaque 30-day tokens, persists hashes and emits no token logs', async () => {
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-1', db);
    const logs = vi.spyOn(console, 'log');
    const errors = vi.spyOn(console, 'error');
    try {
      const first = await exchangeGroupCode(guest.code, db);
      const second = await exchangeGroupCode(guest.code, db);
      expect(first.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.sessionToken).not.toBe(second.sessionToken);
      expect((await requireGuest(first.sessionToken, db)).groupId).toBe('group-1');
      const rows = await db`select * from wedding.guest_sessions`;
      const stored = rows.find(row => row.token_hash === hash(first.sessionToken));
      expect(stored).toBeDefined();
      expect(stored!.expires_at.getTime() - stored!.created_at.getTime()).toBe(30 * 86400_000);
      const groupRows = await db`select * from wedding.invitation_groups`;
      for (const token of [guest.code, first.sessionToken, second.sessionToken]) {
        expect(JSON.stringify([...rows, ...groupRows])).not.toContain(token);
        expect(JSON.stringify([...logs.mock.calls, ...errors.mock.calls])).not.toContain(token);
      }
      await expect(exchangeGroupCode(randomBytes(32).toString('base64url'), db)).rejects.toMatchObject({ status: 401 });
    } finally { logs.mockRestore(); errors.mockRestore(); }
  });
});

test('exchange waits for rotation and revalidates the old code under a row lock', async () => {
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-1', db);
    let unlock!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>(resolve => { unlock = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const rotation = withTestAdmin(admin => admin.begin(async tx => {
      await tx`update wedding.invitation_groups set code_hash=${hash(randomUUID())}, rotated_at=clock_timestamp() where id='group-1'`;
      locked(); await gate;
      await tx`update wedding.guest_sessions set revoked_at=clock_timestamp() where group_id='group-1'`;
    }).then(() => {}));
    await ready;
    const exchange = expect(exchangeGroupCode(guest.code, db)).rejects.toMatchObject({ status: 401 });
    // Query PostgreSQL itself to prove the exchange is actually waiting on the rotation.
    try {
      await withTestAdmin(async admin => {
        await vi.waitFor(async () => {
          const waiting = await admin`select pid from pg_stat_activity where datname='wedding_test' and usename='wedding_app' and wait_event_type='Lock'`;
          expect(waiting.length).toBeGreaterThan(0);
        });
      });
    } finally { unlock(); }
    await rotation;
    await exchange;
    expect((await db`select id from wedding.guest_sessions where revoked_at is null`)).toHaveLength(0);
  });
});

test('durable limiter atomically allows five concurrent attempts and renews expired windows', async () => {
  await withTestDb(async db => {
    const key = `access:192.0.2.1:${randomUUID()}`;
    const independent = postgres(testDatabaseUrl(process.env.TEST_DATABASE_URL), { max: 5, onnotice: () => {} });
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => consumeRateLimit(key, 5, 900, i % 2 ? db : independent)));
    try { await expect(consumeRateLimit(key, 5, 900, independent)).rejects.toMatchObject({ status: 429 }); }
    finally { await independent.end({ timeout: 2 }); }
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(5);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 429 });
    const [bucket] = await db`select * from wedding.abuse_buckets`;
    expect(bucket.key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(bucket)).not.toContain('192.0.2.1');
    expect(bucket.expires_at.getTime() - bucket.window_start.getTime()).toBe(900_000);
    await db`update wedding.abuse_buckets set window_start=now()-interval '20 minutes', expires_at=now()-interval '5 minutes'`;
    await consumeRateLimit(key, 5, 900, db);
    expect((await db`select count from wedding.abuse_buckets`)[0].count).toBe(1);
  });
});

test('trusts platform IP only on Vercel, ignores spoofed local headers, and uses secure cookies elsewhere', () => {
  const request = new Request(`${origin}/api/access`, { headers: { Origin: origin, 'x-forwarded-for': '203.0.113.9', 'x-vercel-forwarded-for': '203.0.113.8' } });
  expect(accessRateLimitKey(request, { APP_ORIGIN: origin })).toBe('access:loopback');
  expect(accessRateLimitKey(request, { APP_ORIGIN: 'https://example.com', VERCEL: '1' })).toBe('access:203.0.113.8');
  expect(() => accessRateLimitKey(request, { APP_ORIGIN: 'https://example.com' })).toThrow();
  expect(() => accessRateLimitKey(new Request(origin), { APP_ORIGIN: 'https://example.com', VERCEL: '1' })).toThrow();
  expect(guestCookieSecure({ APP_ORIGIN: origin })).toBe(true);
  expect(guestCookieSecure({ APP_ORIGIN: origin, ALLOW_INSECURE_LOCAL_COOKIES: 'true' })).toBe(false);
  expect(() => guestCookieSecure({ APP_ORIGIN: 'http://example.com', ALLOW_INSECURE_LOCAL_COOKIES: 'true' })).toThrow();
  expect(guestCookieSecure({ APP_ORIGIN: 'https://localhost', ALLOW_INSECURE_LOCAL_COOKIES: 'true' })).toBe(true);
  expect(() => assertSameOrigin(new Request(origin, { headers: { Origin: 'https://evil.example' } }))).toThrow();
});

test('HTTP gate rejects direct reads, invalid cookies, foreign origins and non-JSON requests', async () => {
  await withTestDb(async db => {
    const expired = await seedGuestSession('group-1', db);
    await db`update wedding.guest_sessions set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=${expired.actor.sessionId}`;
    expect((await fetch(`${origin}/invitation`, { headers: { Cookie: `wedding_guest=${expired.cookie}` }, redirect: 'manual' })).status).toBe(307);
    for (const cookie of ['', 'wedding_guest=forged']) {
      const response = await fetch(`${origin}/invitation`, { headers: { Cookie: cookie }, redirect: 'manual' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/');
      expect(await response.text()).not.toContain('mehendi');
    }
    for (const Origin of ['https://evil.example', 'null', '']) expect((await post({ code: 'secret' }, { Origin })).status).toBe(403);
    expect((await post({ code: 'secret' }, { 'Content-Type': 'text/plain' })).status).toBe(415);
    const malformed = await fetch(`${origin}/api/access`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain('SyntaxError');
    expect((await post({ code: 'x'.repeat(2048) })).status).toBe(413);
  });
});

test('HTTP exchange sets private cookie and serves only authorized HTML across group changes', async () => {
  await withTestDb(async db => {
    const one = await seedGuestSession('group-1', db);
    const two = await seedGuestSession('group-2', db);
    for (const [guest, count] of [[one, 8], [two, 6]] as const) {
      const response = await post({ code: guest.code });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ redirectTo: '/invitation' });
      expect(response.headers.get('cache-control')).toContain('no-store');
      const cookie = response.headers.get('set-cookie')!;
      expect(cookie).toContain('HttpOnly'); expect(cookie.toLowerCase()).toContain('samesite=lax');
      expect(cookie).toContain('Path=/'); expect(cookie).not.toContain('Secure');
      const token = cookie.split(';')[0].split('=')[1];
      expect((await requireGuest(token, db)).groupId).toBe(guest.actor.groupId);
      const page = await fetch(`${origin}/invitation`, { headers: { Cookie: cookie.split(';')[0] } });
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toContain('no-store');
      const html = await page.text();
      expect((html.match(/data-event-id=/g) ?? []).length).toBe(count);
      if (count === 6) { expect(html).not.toContain('mehendi'); expect(html).not.toContain('closing-dinner'); }
    }
    await db`update wedding.guest_sessions set revoked_at=now()`;
    expect((await fetch(`${origin}/invitation`, { headers: { Cookie: `wedding_guest=${one.cookie}` }, redirect: 'manual' })).status).toBe(307);
  });
});

test('sixth HTTP attempt is rejected despite attacker-controlled forwarding headers', async () => {
  await withTestDb(async db => {
    for (let i = 0; i < 5; i++) expect((await post({ code: randomBytes(32).toString('base64url') }, { 'x-forwarded-for': `192.0.2.${i}`, 'x-vercel-forwarded-for': `192.0.2.${i}` })).status).toBe(401);
    expect((await post({ code: randomBytes(32).toString('base64url') })).status).toBe(429);
    expect((await db`select key_hash from wedding.abuse_buckets`)).toHaveLength(1);
  });
});
