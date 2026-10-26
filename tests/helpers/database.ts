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
