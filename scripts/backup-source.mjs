// Explicit source-only configuration. Restore helpers remain loopback-only.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request } from 'node:https';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { localUrl, runPg } from './recovery.mjs';
export const SOURCE_TABLES = ['invitation_groups','guest_sessions','events','event_groups','website_content','content_photos','site_settings','organizer_users','rsvp_submissions','rsvp_guests','rsvp_event_selections','edit_sessions','audit_log','abuse_buckets'];
const hostedKeys = ['BACKUP_DATABASE_URL','BACKUP_EXPECTED_DATABASE','BACKUP_EXPECTED_DATABASE_USER','BACKUP_SUPABASE_URL','BACKUP_SUPABASE_SECRET_KEY','BACKUP_PHOTO_BUCKET','BACKUP_HOSTED_SOURCE_ACK','BACKUP_DATABASE_CA_FILE','BACKUP_STORAGE_CA_FILE'];
async function certificate(file) {
  if (!file) return undefined;
  const ca = await readFile(resolve(file), 'utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw Error('INVALID_BACKUP_CA');
  return ca;
}
/** @param {Record<string, string | undefined>} [env] */
export async function backupSource(env = process.env) {
  const mode = env.BACKUP_SOURCE_MODE || 'local';
  if (!['local','hosted'].includes(mode)) throw Error('INVALID_BACKUP_SOURCE_MODE');
  const timeoutMs = Number(env.BACKUP_OPERATION_TIMEOUT_MS || 120_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900_000) throw Error('INVALID_BACKUP_TIMEOUT');
  let url, api, bucket, secret, expectedDatabase, expectedUser;
  if (mode === 'local') {
    if (hostedKeys.some(name => env[name])) throw Error('HOSTED_BACKUP_REQUIRES_EXPLICIT_MODE');
    url = localUrl(env.DATABASE_ADMIN_URL);
    expectedDatabase = decodeURIComponent(url.pathname.slice(1));
    if (!['wedding_dev','wedding_test'].includes(expectedDatabase)) throw Error('INVALID_LOCAL_SOURCE');
    expectedUser = decodeURIComponent(url.username);
    api = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '');
    if (api.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(api.hostname)) throw Error('LOCAL_STORAGE_REQUIRED');
    bucket = expectedDatabase === 'wedding_test' ? 'wedding-photos-test' : 'wedding-photos-dev';
    secret = env.SUPABASE_SECRET_KEY;
  } else {
    if (env.BACKUP_HOSTED_SOURCE_ACK !== 'I_APPROVE_THIS_HOSTED_BACKUP_SOURCE') throw Error('HOSTED_BACKUP_ACK_REQUIRED');
    url = new URL(env.BACKUP_DATABASE_URL || '');
    if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.search || url.hash) throw Error('INVALID_HOSTED_DATABASE');
    expectedDatabase = env.BACKUP_EXPECTED_DATABASE;
    expectedUser = env.BACKUP_EXPECTED_DATABASE_USER;
    if (!expectedDatabase || !expectedUser || decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) throw Error('HOSTED_SOURCE_IDENTITY_REQUIRED');
    api = new URL(env.BACKUP_SUPABASE_URL || '');
    if (api.protocol !== 'https:') throw Error('HOSTED_STORAGE_HTTPS_REQUIRED');
    bucket = env.BACKUP_PHOTO_BUCKET;
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(bucket || '') || bucket.includes('..')) throw Error('INVALID_BACKUP_BUCKET');
    secret = env.BACKUP_SUPABASE_SECRET_KEY;
  }
  if (!secret || !expectedUser || api.username || api.password || api.search || api.hash || api.pathname !== '/') throw Error('INVALID_BACKUP_SOURCE_CONFIGURATION');
  const databaseCa = await certificate(env.BACKUP_DATABASE_CA_FILE);
  const storageCa = await certificate(env.BACKUP_STORAGE_CA_FILE);
  const databaseOptions = {
    max: 1, connect_timeout: 10, onnotice: () => {},
    // Backend-side idle timeout releases snapshot/publication locks even if the operator dies.
    connection: { statement_timeout: timeoutMs, idle_in_transaction_session_timeout: timeoutMs },
    ssl: mode === 'hosted' ? { rejectUnauthorized: true, ...(databaseCa ? { ca: databaseCa } : {}) } : false,
  };
  return { mode, url, api, bucket, secret, expectedDatabase, expectedUser, databaseOptions, storageCa, databaseCaFile: env.BACKUP_DATABASE_CA_FILE ? resolve(env.BACKUP_DATABASE_CA_FILE) : undefined, timeoutMs };
}
export function sourceDatabase(source) { return postgres(source.url.href, source.databaseOptions); }
/** @param {Record<string, string | undefined>} [inherited] */
export function sourcePgEnvironment(source, inherited = process.env) {
  // Libpq variables cannot silently override hostname, role, TLS or transaction settings.
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) => !name.startsWith('PG')));
  return { ...env, PGHOST: source.url.hostname, PGPORT: source.url.port || '5432', PGDATABASE: source.expectedDatabase, PGUSER: decodeURIComponent(source.url.username), PGPASSWORD: decodeURIComponent(source.url.password), PGSSLMODE: source.mode === 'hosted' ? 'verify-full' : 'disable', ...(source.mode === 'hosted' ? { PGSSLROOTCERT: source.databaseCaFile || 'system' } : {}), PGGSSENCMODE: 'disable', PGCONNECT_TIMEOUT: '10' };
}
export function sourceDump(source, args) { return runPg('pg_dump', sourcePgEnvironment(source), args, source.timeoutMs); }
export function verifiedStorageFetch(source) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init.method || (input instanceof Request ? input.method : 'GET');
    if (url.origin !== source.api.origin || url.protocol !== 'https:' || !['GET','HEAD'].includes(method) || url.username || url.password) throw Error('BACKUP_STORAGE_ORIGIN_MISMATCH');
    const headers = Object.fromEntries(new Headers(init.headers || (input instanceof Request ? input.headers : undefined)));
    return new Promise((resolveResponse, reject) => {
      // Explicit rejection overrides even an unsafe NODE_TLS_REJECT_UNAUTHORIZED environment.
      const req = request(url, { method, headers, rejectUnauthorized: true, ...(source.storageCa ? { ca: source.storageCa } : {}) }, res => {
        const chunks = []; let bytes = 0;
        res.on('data', chunk => { bytes += chunk.length; if (bytes > 11 * 1024 * 1024) req.destroy(Error('BACKUP_STORAGE_RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => { clearTimeout(timer); resolveResponse(new Response(method === 'HEAD' || [204,205,304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: Object.entries(res.headers).filter(([,value]) => value !== undefined).map(([name,value]) => [name,Array.isArray(value) ? value.join(', ') : value]) })); });
      });
      // Absolute duration, not idle-only socket timeout; redirects are never followed.
      const timer = setTimeout(() => req.destroy(Error('BACKUP_STORAGE_TIMEOUT')), source.timeoutMs);
      req.on('error', error => { clearTimeout(timer); reject(error); }); req.end();
    });
  };
}
export function sourceStorage(source) {
  const boundedLocalFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(source.timeoutMs), redirect: 'error' });
  return createClient(source.api.href, source.secret, { auth: { persistSession: false }, global: { fetch: source.mode === 'hosted' ? verifiedStorageFetch(source) : boundedLocalFetch } }).storage;
}
export function assertSourceBucket(source, bucket) {
  if (!bucket || bucket.id !== source.bucket || bucket.public !== false) throw Error('PRIVATE_SOURCE_BUCKET_REQUIRED');
}
export function assertSourceIdentity(source, identity, tables) {
  if (identity?.name !== source.expectedDatabase || identity?.user !== source.expectedUser || (source.mode === 'hosted' && identity.ssl !== true)) throw Error('BACKUP_SOURCE_IDENTITY_MISMATCH');
  const names = new Set(tables.map(table => table.name));
  if (SOURCE_TABLES.some(name => !names.has(name)) || tables.some(table => !table.rls || !table.forced || table.owner === 'wedding_app')) throw Error('BACKUP_APPLICATION_SCHEMA_INVALID');
}
