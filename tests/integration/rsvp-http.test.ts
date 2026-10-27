import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createRsvp } from '@/features/rsvp/service';
import { exchangeGroupCode } from '@/features/access/service';
import type { Database } from '@/lib/db/server';
import type { GroupId } from '@/features/wedding/types';
import { acceptedInput, declinedInput } from '../fixtures/wedding';
import { seedGuestSession, withTestAdmin, withTestDb } from '../helpers/database';

const origin = process.env.TEST_APP_ORIGIN!;
const token = () => randomBytes(32).toString('base64url');
const command = () => ({ requestId: randomUUID(), editToken: token(), response: acceptedInput() });
function call(path: string, method = 'GET', body?: unknown, cookie = '', headers: Record<string, string> = {}) {
  return fetch(`${origin}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
}
async function fixture(db: Database, group: GroupId = 'group-1') {
  const guest = await seedGuestSession(group, db);
  const input = command();
  const saved = await createRsvp(guest.actor, group, input, db);
  return { guest, input, saved, cookie: `wedding_guest=${guest.cookie}` };
}
async function editor(cookie: string, raw: string) {
  const exchanged = await call('/api/rsvp/edit-session', 'POST', { token: raw }, cookie);
  expect(exchanged.status).toBe(200);
  const setCookie = exchanged.headers.get('set-cookie')!;
  const combined = `${cookie}; ${setCookie.split(';')[0]}`;
  const current = await (await call('/api/rsvp/current', 'GET', undefined, combined)).json();
  return { exchanged, setCookie, cookie: combined, submissionId: current.id as string };
}
async function error(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body = await response.json();
  expect(typeof body.code).toBe('string');
  if (code) expect(body.code).toBe(code);
  expect(Object.keys(body).every(key => ['code', 'fieldErrors'].includes(key))).toBe(true);
  return body;
}

// Removing cookie gates or exposing a listing would disclose other guests' records.
test('all RSVP reads/writes require real guest cookies and no guest listing/export exists', async () => {
  await withTestDb(async db => {
    const unauthenticatedCreate = await call('/api/rsvp', 'POST', command());
    await error(unauthenticatedCreate, 401);
    for (const [path, method, body] of [
      ['/api/events', 'GET', undefined], ['/api/rsvp/edit-session', 'POST', { token: token() }],
      ['/api/rsvp/current', 'GET', undefined], ['/api/rsvp/current', 'PATCH', { expectedSubmissionId:randomUUID(),expectedVersion: 1, response: declinedInput() }],
    ] as const) await error(await call(path, method, body), 401);
    await error(await call('/api/events', 'GET', undefined, 'wedding_guest=forged'), 401);
    const one = await fixture(db);
    for (const path of ['/api/rsvp', '/api/rsvp/export', '/api/rsvp/responses', `/api/rsvp/${one.saved.id}`]) {
      expect([404, 405]).toContain((await call(path, 'GET', undefined, one.cookie)).status);
    }
  });
});

// Taking group from a query/body instead of the authenticated actor would expose two extra events.
test('events derive the group from the live session and filter eight versus six events', async () => {
  await withTestDb(async db => {
    const one = await seedGuestSession('group-1', db), two = await seedGuestSession('group-2', db);
    for (const [guest, count] of [[one, 8], [two, 6]] as const) {
      const response = await call('/api/events?groupId=group-1', 'GET', undefined, `wedding_guest=${guest.cookie}`);
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
      const { events } = await response.json(); expect(events).toHaveLength(count);
      if (count === 6) {
        const ids = events.map((event: { id: string }) => event.id);
        expect(ids).not.toContain('mehendi'); expect(ids).not.toContain('closing-dinner');
      }
    }
    await db`update wedding.invitation_groups set rotated_at=clock_timestamp() where id='group-2'`;
    await error(await call('/api/events', 'GET', undefined, `wedding_guest=${two.cookie}`), 401);
  });
});

// Omitting server-side eligibility, cancellation, size or normalized validation would persist forbidden input.
test('create enforces live group eligibility, cancellation, party size and form validation', async () => {
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-2', db), cookie = `wedding_guest=${guest.cookie}`;
    const group2SelectingMehendi = await call('/api/rsvp', 'POST', { ...command(), response: acceptedInput({ eventIds: ['mehendi'] }) }, cookie);
    expect((await error(group2SelectingMehendi, 422, 'forbidden_event')).fieldErrors).toHaveProperty('eventIds.0');
    await db`update wedding.events set cancelled=true where id='haldi'`;
    await error(await call('/api/rsvp', 'POST', command(), cookie), 422, 'forbidden_event');
    await db`update wedding.events set cancelled=false where id='haldi'`;
    await db`update wedding.site_settings set max_party_size=1 where singleton`;
    await error(await call('/api/rsvp', 'POST', command(), cookie), 422, 'VALIDATION_FAILED');
    await error(await call('/api/rsvp', 'POST', { ...command(), response: acceptedInput({ eventIds: [] }) }, cookie), 422);
    await error(await call('/api/rsvp', 'POST', { ...command(), requestId: 'forged' }, cookie), 400);
    await error(await call('/api/rsvp', 'POST', { ...command(), editToken: '../secret' }, cookie), 400);
    expect((await db`select id from wedding.rsvp_submissions`)).toHaveLength(0);
  });
});

// A token must grant exactly its persisted party, with a new hash-only, 24-hour session.
test('create, retry and exchange return only the authorized party and an HttpOnly 24-hour edit cookie', async () => {
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-1', db), cookie = `wedding_guest=${guest.cookie}`;
    const input = { ...command(), editToken: 'T'.repeat(43) };
    const created = await call('/api/rsvp', 'POST', input, cookie);
    expect(created.status).toBe(200); expect(created.headers.get('cache-control')).toContain('no-store');
    const saved = await created.json(); expect(saved).toMatchObject({ version: 1, duplicateWarning: false, editPath: `/rsvp/edit#${input.editToken}` });
    expect(await (await call('/api/rsvp', 'POST', input, cookie)).json()).toEqual(saved);
    await error(await call('/api/rsvp', 'POST', { ...input, response: declinedInput() }, cookie), 409, 'idempotency_conflict');
    const other = await createRsvp(guest.actor, 'group-1', command(), db);
    const session = await editor(cookie, input.editToken);
    expect(await session.exchanged.json()).toEqual({});
    expect(session.setCookie).toContain('HttpOnly'); expect(session.setCookie).toContain('Path=/');
    expect(session.setCookie.toLowerCase()).toContain('samesite=lax'); expect(session.setCookie).not.toContain('Secure');
    const raw = session.setCookie.split(';')[0].split('=')[1]; expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(raw).not.toBe(input.editToken);
    const [stored] = await db`select * from wedding.edit_sessions`;
    expect(stored.token_hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(stored.expires_at.getTime() - stored.created_at.getTime()).toBe(86400_000);
    const expiry = session.setCookie.match(/Expires=([^;]+)/i)![1]; expect(Math.abs(Date.parse(expiry) - stored.expires_at.getTime())).toBeLessThan(1000);
    const current = await call('/api/rsvp/current', 'GET', undefined, session.cookie);
    expect(current.status).toBe(200); expect(current.headers.get('cache-control')).toContain('no-store');
    expect(await current.json()).toMatchObject({ id: saved.id, version: 1, groupId: 'group-1' });
    await error(await call(`/api/rsvp/current?id=${other.id}`, 'GET', undefined, session.cookie), 400);
    await error(await call(`/api/rsvp/current?id=${other.id}`, 'PATCH', { expectedSubmissionId:session.submissionId,expectedVersion: 1, response: declinedInput() }, session.cookie), 400);
    await error(await call('/api/rsvp/current', 'GET', undefined, cookie), 401);
    const rows = await db`select to_jsonb(s) as row from wedding.rsvp_submissions s union all select to_jsonb(e) from wedding.edit_sessions e`;
    expect(JSON.stringify(rows)).not.toContain(raw); expect(JSON.stringify(rows)).not.toContain(input.editToken);
  });
});

// Missing guest/group checks would let a stolen edit token cross invitation boundaries.
test('exchange rejects wrong-group/unknown tokens and strict body fields without issuing sessions', async () => {
  await withTestDb(async db => {
    const one = await fixture(db), two = await seedGuestSession('group-2', db), cookie = `wedding_guest=${two.cookie}`;
    await error(await call('/api/rsvp/edit-session', 'POST', { token: one.input.editToken }, cookie), 403);
    await error(await call('/api/rsvp/edit-session', 'POST', { token: token() }, cookie), 403);
    await error(await call('/api/rsvp/edit-session', 'POST', { token: 'bad' }, one.cookie), 400);
    await error(await call('/api/rsvp/edit-session', 'POST', { token: one.input.editToken, submissionId: randomUUID() }, one.cookie), 400);
    expect((await db`select id from wedding.edit_sessions`)).toHaveLength(0);
    await db`update wedding.guest_sessions set revoked_at=clock_timestamp() where id=${one.guest.actor.sessionId}`;
    await error(await call('/api/rsvp/edit-session', 'POST', { token: one.input.editToken }, one.cookie), 401);
  });
});

// A session must remain live and scoped to the party's actual group on every request.
test('current response needs both valid guest and nonexpired, nonrevoked matching editor sessions', async () => {
  await withTestDb(async db => {
    const one = await fixture(db), session = await editor(one.cookie, one.input.editToken);
    const rawCookie = session.setCookie.split(';')[0];
    await error(await call('/api/rsvp/current', 'GET', undefined, rawCookie), 401);
    await error(await call('/api/rsvp/current', 'GET', undefined, `${one.cookie}; wedding_edit=forged`), 401);
    const two = await seedGuestSession('group-2', db);
    await error(await call('/api/rsvp/current', 'GET', undefined, `wedding_guest=${two.cookie}; ${rawCookie}`), 403);
    await db`update wedding.edit_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day'`;
    await error(await call('/api/rsvp/current', 'GET', undefined, session.cookie), 401);
    await error(await call('/api/rsvp/current', 'PATCH', { expectedSubmissionId:session.submissionId,expectedVersion:1,response:declinedInput()}, session.cookie), 401);
    await db`update wedding.edit_sessions set expires_at=now()+interval '1 day',revoked_at=now()`;
    await error(await call('/api/rsvp/current', 'GET', undefined, session.cookie), 401);
    await db`update wedding.edit_sessions set revoked_at=null`;
    await db`update wedding.guest_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=${one.guest.actor.sessionId}`;
    await error(await call('/api/rsvp/current', 'GET', undefined, session.cookie), 401);
    await db`update wedding.guest_sessions set created_at=clock_timestamp(),expires_at=now()+interval '1 day' where id=${one.guest.actor.sessionId}`;
    await db`update wedding.invitation_groups set code_hash=null where id='group-1'`;
    await error(await call('/api/rsvp/current', 'GET', undefined, session.cookie), 401);
  });
});

// Reject caller identity/override authority before handing the narrow command to services.
test('strict commands reject forged actors, IDs, source, override and result-version fields', async () => {
  await withTestDb(async db => {
    const one = await fixture(db), session = await editor(one.cookie, one.input.editToken);
    for (const key of ['actor', 'groupId', 'submissionId', 'deadlineOverride', 'source', 'version', 'override', 'expectedVersion']) {
      await error(await call('/api/rsvp', 'POST', { ...command(), [key]: { kind:'organizer',userId:randomUUID() } }, one.cookie), 400);
    }
    for (const key of ['actor', 'groupId', 'submissionId', 'deadlineOverride', 'source', 'version', 'override', 'requestId', 'editToken']) {
      await error(await call('/api/rsvp/current', 'PATCH', { expectedSubmissionId:session.submissionId,expectedVersion:1,response:declinedInput(),[key]:randomUUID() }, session.cookie), 400);
    }
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:0,response:declinedInput() }, session.cookie),400);
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:{...declinedInput(),actor:'organizer'} }, session.cookie),422);
    expect((await db`select version from wedding.rsvp_submissions`)[0].version).toBe(1);
  });
});

// Origin checks must precede rate-limit writes and RSVP/session writes.
test('foreign and missing origins fail before any mutation or rate consumption', async () => {
  await withTestDb(async db => {
    const one = await fixture(db), session = await editor(one.cookie, one.input.editToken);
    await db`delete from wedding.abuse_buckets`;
    for (const Origin of ['https://evil.example', 'null', '']) {
      await error(await call('/api/rsvp','POST',command(),one.cookie,{Origin}),403,'FORBIDDEN_ORIGIN');
      await error(await call('/api/rsvp/edit-session','POST',{token:one.input.editToken},one.cookie,{Origin}),403,'FORBIDDEN_ORIGIN');
      const foreignOriginEdit = await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:declinedInput()},session.cookie,{Origin});
      await error(foreignOriginEdit,403,'FORBIDDEN_ORIGIN');
    }
    expect(await db`select key_hash from wedding.abuse_buckets`).toHaveLength(0);
    expect(await db`select id from wedding.edit_sessions`).toHaveLength(1);
    expect((await db`select version from wedding.rsvp_submissions`)[0].version).toBe(1);
  });
});

// Checking only Content-Length or character length misses chunked and multibyte payloads.
test('64 KiB byte limit covers declared and chunked bodies; malformed/non-JSON input is safe', async () => {
  await withTestDb(async db => {
    const one = await fixture(db), session = await editor(one.cookie, one.input.editToken);
    const oversizedCreate = await call('/api/rsvp','POST',{...command(),padding:'x'.repeat(65536)},one.cookie);
    await error(oversizedCreate,413,'REQUEST_TOO_LARGE');
    for (const [path,method,cookie] of [['/api/rsvp','POST',one.cookie],['/api/rsvp/current','PATCH',session.cookie],['/api/rsvp/edit-session','POST',one.cookie]]) {
      const chunk = Buffer.from(JSON.stringify({padding:'é'.repeat(40000)}));
      const body = new ReadableStream<Uint8Array>({start(controller){ controller.enqueue(chunk.subarray(0,40000));controller.enqueue(chunk.subarray(40000));controller.close(); }});
      const response = await fetch(`${origin}${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body,duplex:'half'} as RequestInit);
      await error(response,413,'REQUEST_TOO_LARGE');
    }
    await error(await call('/api/rsvp','POST',command(),one.cookie,{'Content-Type':'text/plain'}),415,'JSON_REQUIRED');
    await error(await fetch(`${origin}/api/rsvp`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:one.cookie},body:'{'}),400,'INVALID_REQUEST');
    const exact = JSON.stringify(command());
    const exactBody = `${exact}${' '.repeat(65536 - Buffer.byteLength(exact))}`;
    expect((await fetch(`${origin}/api/rsvp`, { method:'POST', headers:{Origin:origin,'Content-Type':'application/json',Cookie:one.cookie},body:exactBody })).status).toBe(200);
    expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(2);
    expect((await db`select version from wedding.rsvp_submissions where id=${one.saved.id}`)[0].version).toBe(1);
  });
});

// New creates close at the stored instant while authenticated edits keep working with optimistic versions.
test('deadline blocks new creates while own edits retain identity and reject stale/event-forbidden changes', async () => {
  await withTestDb(async db => {
    const one = await fixture(db,'group-2'), session = await editor(one.cookie,one.input.editToken);
    await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()-interval '1 second' where singleton`;
    await error(await call('/api/rsvp','POST',command(),one.cookie),403,'closed');
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:acceptedInput({eventIds:['mehendi']})},session.cookie),422,'forbidden_event');
    await db`update wedding.events set cancelled=true where id='haldi'`;
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:acceptedInput()},session.cookie),422,'forbidden_event');
    await db`update wedding.events set cancelled=false where id='haldi'`;
    await db`update wedding.site_settings set max_party_size=1 where singleton`;
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:acceptedInput()},session.cookie),422,'VALIDATION_FAILED');
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:acceptedInput({eventIds:[]})},session.cookie),422);
    const changed = await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:declinedInput()},session.cookie);
    expect(changed.status).toBe(200); expect(await changed.json()).toMatchObject({id:one.saved.id,version:2});
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:declinedInput()},session.cookie),409,'conflict');
    const current = await call('/api/rsvp/current','GET',undefined,session.cookie);
    expect(await current.json()).toMatchObject({id:one.saved.id,version:2,response:{decision:'decline'}});
    expect(await db`select * from wedding.rsvp_event_selections`).toHaveLength(0);
  });
});

// Durable IP and guest limits must count retries and resist spoofed forwarding headers and new guest cookies.
test('create allows ten attempts then refuses the eleventh before writes across guest sessions', async () => {
  await withTestDb(async db => {
    const guest=await seedGuestSession('group-1',db),cookie=`wedding_guest=${guest.cookie}`, input=command();
    for(let i=0;i<10;i++) expect((await call('/api/rsvp','POST',input,cookie,{'x-forwarded-for':`192.0.2.${i}`})).status).toBe(200);
    const blocked=await call('/api/rsvp','POST',command(),cookie);await error(blocked,429,'RATE_LIMITED');expect(blocked.headers.get('retry-after')).toBe('900');
    const other=await exchangeGroupCode(guest.code,db);
    await error(await call('/api/rsvp','POST',command(),`wedding_guest=${other.sessionToken}`),429,'RATE_LIMITED');
    expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(1);
    const buckets=await db`select * from wedding.abuse_buckets`;
    expect(buckets).toHaveLength(2);expect(JSON.stringify(buckets)).not.toContain(guest.cookie);expect(JSON.stringify(buckets)).not.toContain('192.0.2.');
    await db`update wedding.abuse_buckets set window_start=now()-interval '20 minutes',expires_at=now()-interval '5 minutes'`;
    expect((await call('/api/rsvp','POST',input,cookie)).status).toBe(200);
  });
});

// Renewing an IP window must not reset an independent guest-session window.
test('create guest-session limit survives renewal of the IP window', async () => {
  await withTestDb(async db => {
    const guest=await seedGuestSession('group-1',db),other=await exchangeGroupCode(guest.code,db),input=command();
    expect((await call('/api/rsvp','POST',command(),`wedding_guest=${other.sessionToken}`)).status).toBe(200);
    for(let i=0;i<9;i++) expect((await call('/api/rsvp','POST',input,`wedding_guest=${guest.cookie}`)).status).toBe(200);
    // Only the IP bucket received all ten attempts; the guests received nine and one.
    expect(await db`delete from wedding.abuse_buckets where count=10 returning key_hash`).toHaveLength(1);
    expect((await call('/api/rsvp','POST',input,`wedding_guest=${guest.cookie}`)).status).toBe(200);
    await error(await call('/api/rsvp','POST',command(),`wedding_guest=${guest.cookie}`),429,'RATE_LIMITED');
    expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(2);
  });
});

// Edit limits count actual mutations; the rejected 21st attempt cannot advance the version.
test('edit allows twenty attempts per edit session and refuses the twenty-first before writes', async () => {
  await withTestDb(async db => {
    const one=await fixture(db),session=await editor(one.cookie,one.input.editToken);
    for(let i=1;i<=20;i++) expect((await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:i,response:declinedInput()},session.cookie)).status).toBe(200);
    await error(await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:21,response:acceptedInput()},session.cookie),429,'RATE_LIMITED');
    expect((await db`select version,decision from wedding.rsvp_submissions`)[0]).toMatchObject({version:21,decision:'decline'});
    const fresh=await editor(one.cookie,one.input.editToken);
    expect((await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:21,response:declinedInput()},fresh.cookie)).status).toBe(200);
  });
});

// Failed lookup attempts must be rate limited before more hashed-token lookups/session inserts.
test('edit-token exchange allows five attempts per IP then refuses the sixth with no session', async () => {
  await withTestDb(async db => {
    const one=await fixture(db);
    for(let i=0;i<5;i++) await error(await call('/api/rsvp/edit-session','POST',{token:token()},one.cookie,{'x-vercel-forwarded-for':`192.0.2.${i}`}),403);
    await error(await call('/api/rsvp/edit-session','POST',{token:one.input.editToken},one.cookie),429,'RATE_LIMITED');
    expect(await db`select id from wedding.edit_sessions`).toHaveLength(0);
  });
});

// A real database failure must roll back and return retryable failure, never a false save.
test('actual database write failures return safe retryable 503 and a retry can save once', async () => {
  await withTestDb(async db => {
    const one=await fixture(db),session=await editor(one.cookie,one.input.editToken), input=command();
    await withTestAdmin(async admin=>{
      await admin.unsafe("create function wedding.fail_http_write() returns trigger language plpgsql as $$ begin raise exception 'PRIVATE_DATABASE_FAILURE'; end $$");
      await admin.unsafe('create trigger fail_http before insert or update on wedding.rsvp_submissions for each row execute function wedding.fail_http_write()');
      await admin.unsafe('create trigger fail_http before insert on wedding.edit_sessions for each row execute function wedding.fail_http_write()');
    });
    try {
      for(const response of [await call('/api/rsvp','POST',input,one.cookie),await call('/api/rsvp/current','PATCH',{ expectedSubmissionId:session.submissionId,expectedVersion:1,response:declinedInput()},session.cookie),await call('/api/rsvp/edit-session','POST',{token:one.input.editToken},one.cookie)]) {
        const body=await error(response,503,'RSVP_UNAVAILABLE');expect(JSON.stringify(body)).not.toContain('PRIVATE_DATABASE_FAILURE');expect(response.headers.get('retry-after')).toBe('5');
      }
      expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(1);
      expect((await db`select version from wedding.rsvp_submissions`)[0].version).toBe(1);
      expect(await db`select id from wedding.edit_sessions`).toHaveLength(1);
    } finally {
      await withTestAdmin(async admin=>{await admin.unsafe('drop trigger fail_http on wedding.rsvp_submissions');await admin.unsafe('drop trigger fail_http on wedding.edit_sessions');await admin.unsafe('drop function wedding.fail_http_write()');});
    }
    expect((await call('/api/rsvp','POST',input,one.cookie)).status).toBe(200);
    expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(2);
  });
});

// Direct adapters must revalidate actor attributes against live guest records; no token logs may escape.
test('edit adapters reject forged guest attributes and store/log no raw tokens', async () => {
  await withTestDb(async db => {
    const {exchangeEditToken,requireEditor}=await import('@/features/rsvp/edit-access');
    const one=await fixture(db),logs=vi.spyOn(console,'log'),errors=vi.spyOn(console,'error'),warnings=vi.spyOn(console,'warn');
    try {
      await expect(exchangeEditToken(one.input.editToken,{...one.guest.actor,sessionId:randomUUID()},db)).rejects.toMatchObject({status:401});
      await expect(exchangeEditToken(one.input.editToken,{...one.guest.actor,groupId:'group-2'},db)).rejects.toMatchObject({status:401});
      const exchanged=await exchangeEditToken(one.input.editToken,one.guest.actor,db);
      expect(await requireEditor(exchanged.sessionToken,one.guest.actor,db)).toMatchObject({kind:'editor',groupId:'group-1',submissionId:one.saved.id,guestSessionId:one.guest.actor.sessionId});
      await expect(requireEditor(exchanged.sessionToken,{...one.guest.actor,sessionId:randomUUID()},db)).rejects.toMatchObject({status:401});
      const rows=await db`select to_jsonb(e) as row from wedding.edit_sessions e union all select to_jsonb(r) from wedding.rsvp_submissions r`;
      for(const raw of [exchanged.sessionToken,one.input.editToken]) {expect(JSON.stringify(rows)).not.toContain(raw);expect(JSON.stringify([...logs.mock.calls,...errors.mock.calls,...warnings.mock.calls])).not.toContain(raw);}
    } finally {logs.mockRestore();errors.mockRestore();warnings.mockRestore();}
  });
});

// Authentication before streaming cannot authorize a save after its guest credential is revoked.
test.each(['expired', 'revoked', 'rotated'] as const)('paused PATCH denies a guest %s after initial authentication', async mode => {
  await withTestDb(async db => {
    const one = await fixture(db), session = await editor(one.cookie, one.input.editToken);
    const guestsBefore = await db`select * from wedding.rsvp_guests order by position`;
    const eventsBefore = await db`select * from wedding.rsvp_event_selections order by event_id`;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      controller.enqueue(Buffer.from(`{"expectedSubmissionId":"${one.saved.id}","expectedVersion":1,"response":`));
    } });
    const pending = fetch(`${origin}/api/rsvp/current`, {
      method:'PATCH', headers:{Origin:origin,'Content-Type':'application/json',Cookie:session.cookie},body,duplex:'half',
    } as RequestInit);
    let response!: Response;
    try {
      // PATCH consumes this second bucket only after both authenticators complete.
      await vi.waitFor(async () => expect(await db`select key_hash from wedding.abuse_buckets`).toHaveLength(2));
      if (mode === 'expired') await db`update wedding.guest_sessions set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=${one.guest.actor.sessionId}`;
      else if (mode === 'revoked') await db`update wedding.guest_sessions set revoked_at=clock_timestamp() where id=${one.guest.actor.sessionId}`;
      else await db`update wedding.invitation_groups set rotated_at=clock_timestamp() where id='group-1'`;
    } finally {
      stream.enqueue(Buffer.from(`${JSON.stringify(declinedInput())}}`)); stream.close();
      response = await pending;
    }
    await error(response,403,'forbidden');
    expect((await db`select version,decision from wedding.rsvp_submissions where id=${one.saved.id}`)[0]).toEqual({version:1,decision:'accept'});
    expect(await db`select * from wedding.rsvp_guests order by position`).toEqual(guestsBefore);
    expect(await db`select * from wedding.rsvp_event_selections order by event_id`).toEqual(eventsBefore);
  });
});

test('PATCH requires UUID identity precondition and cannot select a different party',async()=>withTestDb(async db=>{
  const one=await fixture(db);const other=await createRsvp(one.guest.actor,'group-1',command(),db);const session=await editor(one.cookie,one.input.editToken);
  for(const value of [undefined,null,'invalid',1])await error(await call('/api/rsvp/current','PATCH',{expectedSubmissionId:value,expectedVersion:1,response:declinedInput()},session.cookie),400,'INVALID_REQUEST');
  await error(await call('/api/rsvp/current','PATCH',{expectedSubmissionId:other.id,expectedVersion:1,response:declinedInput()},session.cookie),409,'conflict');
  expect((await db`select version,decision from wedding.rsvp_submissions order by id`)).toEqual([{version:1,decision:'accept'},{version:1,decision:'accept'}]);
  const saved=await call('/api/rsvp/current','PATCH',{expectedSubmissionId:one.saved.id,expectedVersion:1,response:declinedInput()},session.cookie);expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({id:one.saved.id,version:2});
}));
