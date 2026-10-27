import { createHash, randomBytes } from 'node:crypto';
import type { GroupId, GuestActor } from '@/features/wedding/types';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/server';

export function testDatabaseUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== 'wedding_test' || url.search || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error('UNSAFE_TEST_DATABASE'); }
}
async function verifyTestIdentity(db: Database, app: boolean) {
  const [row] = await db`select current_database() as name, current_user as role, rolsuper, rolbypassrls from pg_roles where rolname=current_user`;
  if (row?.name !== 'wedding_test' || (app && (row.role !== 'wedding_app' || row.rolsuper || row.rolbypassrls))) throw new Error('UNSAFE_TEST_DATABASE');
}
function testUrls() {
  const application = testDatabaseUrl(process.env.TEST_DATABASE_URL);
  const admin = testDatabaseUrl(process.env.TEST_DATABASE_ADMIN_URL);
  const appUrl = new URL(application), adminUrl = new URL(admin);
  if (appUrl.host !== adminUrl.host || appUrl.pathname !== adminUrl.pathname || appUrl.username === adminUrl.username) throw new Error('UNSAFE_TEST_DATABASE');
  return { application, admin };
}

export async function withTestAdmin(run: (db: Database) => Promise<void>): Promise<void> {
  const db = postgres(testUrls().admin, { max: 1, onnotice: () => {} });
  try { await verifyTestIdentity(db, false); await run(db); }
  finally { await db.end({ timeout: 2 }); }
}
let tail: Promise<void> = Promise.resolve();

/** Reset only application-owned schema in actual loopback wedding_test; vendor DB is never reset. */
export async function withTestDb(run: (db: Database) => Promise<void>): Promise<void> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise(resolve => { release = resolve; });
  await previous;
  let admin: Database | undefined, application: Database | undefined;
  let locked = false;
  try {
    const urls = testUrls();
    admin = postgres(urls.admin, { max: 1, onnotice: () => {}, connect_timeout: 5 });
    application = postgres(urls.application, { max: 1, onnotice: () => {}, connect_timeout: 5 });
    await verifyTestIdentity(admin, false);
    await verifyTestIdentity(application, true);
    await admin`select pg_advisory_lock(20261026, 2)`;
    locked = true;
    // Check actual identity immediately before any destructive SQL.
    await verifyTestIdentity(admin, false);
    await admin.unsafe('drop schema if exists wedding cascade');
    const migrations = (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql')).sort();
    if (migrations.length === 0) throw new Error('WEDDING_MIGRATIONS_MISSING');
    await admin.begin(async tx => {
      for (const file of migrations) await tx.unsafe(await readFile(`supabase/migrations/${file}`, 'utf8'));
      await tx.unsafe(await readFile('supabase/seed.sql', 'utf8'));
    });
    const service = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(service.hostname)) throw new Error('UNSAFE_TEST_STORAGE');
    const client = createClient(service.href, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    let bucket = await client.storage.getBucket('wedding-photos-test');
    if (bucket.error && String(bucket.error.statusCode ?? bucket.error.status) === '404') {
      const created = await client.storage.createBucket('wedding-photos-test', { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] });
      if (created.error) throw new Error('TEST_STORAGE_UNAVAILABLE');
      bucket = await client.storage.getBucket('wedding-photos-test');
    }
    if (bucket.error || bucket.data?.public !== false) throw new Error('TEST_STORAGE_NOT_PRIVATE');
    await run(application);
  } finally {
    try {
      if (locked && admin) await admin`select pg_advisory_unlock(20261026, 2)`;
    } finally {
      try { await Promise.all([admin?.end({ timeout: 2 }), application?.end({ timeout: 2 })]); }
      finally { release(); }
    }
  }
}

/** Synthetic group link/session fixture; never an application authentication bypass. */
export async function seedGuestSession(groupId: GroupId, db: Database): Promise<{ actor: GuestActor; cookie: string; code: string }> {
  const code = randomBytes(32).toString('base64url');
  const codeHash = createHash('sha256').update(code).digest('hex');
  await db.begin(async tx => {
    await tx`update wedding.invitation_groups set code_hash=${codeHash}, rotated_at=clock_timestamp() where id=${groupId}`;
    await tx`update wedding.guest_sessions set revoked_at=clock_timestamp() where group_id=${groupId} and revoked_at is null`;
  });
  const cookie = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(cookie).digest('hex');
  const [session] = await db`insert into wedding.guest_sessions(group_id, token_hash, created_at, expires_at) select ${groupId}, ${tokenHash}, issued_at, issued_at + interval '30 days' from (select clock_timestamp() as issued_at) issued returning id`;
  return { actor: { kind: 'guest', groupId, sessionId: session.id }, cookie, code };
}

/** Synthetic party persisted through the real service; only session issuance is test-only. */
export async function createPartyFixture(groupId: GroupId, db: Database): Promise<{ actor: import('@/features/wedding/types').EditorActor; token: string; party: import('@/features/wedding/types').PartySnapshot }> {
  const { createRsvp, readOwnRsvp } = await import('@/features/rsvp/service');
  const { acceptedInput } = await import('../fixtures/wedding');
  const { randomUUID } = await import('node:crypto');
  const { actor: guest } = await seedGuestSession(groupId, db);
  const token = randomBytes(32).toString('base64url');
  const saved = await createRsvp(guest, groupId, { requestId: randomUUID(), editToken: token, response: acceptedInput() }, db);
  const [session] = await db`insert into wedding.edit_sessions(submission_id,token_hash,expires_at) values(${saved.id},${createHash('sha256').update(randomBytes(32)).digest('hex')},clock_timestamp()+interval '1 day') returning id`;
  const actor = {kind:'editor' as const, groupId, submissionId:saved.id, sessionId:session.id, guestSessionId:guest.sessionId};
  return {actor, token, party:await readOwnRsvp(actor,db)};
}

/** Real local Auth provisioning; this helper is never imported by application code. */
export async function seedOrganizer(db: Database): Promise<{cookieHeader:string;actor:import('@/features/wedding/types').OrganizerActor;email:string;password:string}> {
  const service=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if(!['localhost','127.0.0.1','[::1]'].includes(service.hostname))throw new Error('UNSAFE_TEST_AUTH');
  const email=`organizer-${randomBytes(12).toString('hex')}@example.test`, password=randomBytes(32).toString('base64url');
  const admin=createClient(service.href,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false}});
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error || !created.data.user)throw new Error('TEST_AUTH_PROVISION_FAILED');
  const actor={kind:'organizer' as const,userId:created.data.user.id};
  await db`insert into wedding.organizer_users(user_id) values(${actor.userId})`;
  const {createServerClient}=await import('@supabase/ssr');
  const jar=new Map<string,string>();
  const client=createServerClient(service.href,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[],setAll:values=>{for(const c of values)jar.set(c.name,c.value);}}});
  const login=await client.auth.signInWithPassword({email,password});
  if(login.error)throw new Error('TEST_AUTH_LOGIN_FAILED');
  return {cookieHeader:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),actor,email,password};
}
