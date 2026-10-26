import './operator.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { localDatabaseUrl, ensurePrivateBucket } from './operator.mjs';

export async function writeWeddingSeed(db, seed) {
  await db.begin(async tx => {
    await tx`insert into wedding.invitation_groups(id) values('group-1'),('group-2') on conflict(id) do nothing`;
    for (const event of seed.events) {
      await tx`insert into wedding.events ${tx({ id: event.id, start_at: event.startAt, end_at: event.endAt, title: event.title, description: event.description, venue_sublocation: event.venueSublocation, dress_code: event.dressCode, map_url: event.mapUrl, cancelled: event.cancelled })} on conflict(id) do update set start_at=excluded.start_at,end_at=excluded.end_at,title=excluded.title,description=excluded.description,venue_sublocation=excluded.venue_sublocation,dress_code=excluded.dress_code,map_url=excluded.map_url,cancelled=excluded.cancelled`;
      // Group memberships are fixed; never remove historically selected relationships.
      for (const group of event.eligibleGroups) await tx`insert into wedding.event_groups(event_id,group_id) values(${event.id},${group}) on conflict do nothing`;
    }
    const c = seed.content;
    await tx`insert into wedding.website_content ${tx({ singleton: true, revision: c.revision, couple: c.couple, wedding: c.wedding, story: c.story, families: c.families, welcome: c.welcome, labels: c.labels, ceremony_copy_approved: c.ceremonyCopyApproved, hindi_approved: c.hindiApproved })} on conflict(singleton) do update set revision=excluded.revision,couple=excluded.couple,wedding=excluded.wedding,story=excluded.story,families=excluded.families,welcome=excluded.welcome,labels=excluded.labels,ceremony_copy_approved=excluded.ceremony_copy_approved,hindi_approved=excluded.hindi_approved`;
    await tx`delete from wedding.content_photos`;
    for (const p of c.photos) await tx`insert into wedding.content_photos ${tx({ id: p.id, storage_path: p.storagePath, alt: p.alt, position: p.position, provenance: p.provenance })}`;
    const s = seed.settings;
    await tx`insert into wedding.site_settings ${tx({ singleton: true, new_rsvp_closes_at: s.newRsvpClosesAt, help_phone: s.helpPhone, help_tel_url: s.helpTelUrl, help_whatsapp_url: s.helpWhatsAppUrl, max_party_size: s.maxPartySize })} on conflict(singleton) do update set new_rsvp_closes_at=excluded.new_rsvp_closes_at,help_phone=excluded.help_phone,help_tel_url=excluded.help_tel_url,help_whatsapp_url=excluded.help_whatsapp_url,max_party_size=excluded.max_party_size`;
  });
}

async function main() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node scripts/seed-content.mjs --file <private-json> --expected <independently-reviewed-json> [--test]'); return; }
  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : process.env.WEDDING_SEED_FILE;
  const expectedFile = args.includes('--expected') ? args[args.indexOf('--expected') + 1] : process.env.WEDDING_SEED_EXPECTED_FILE;
  if (!file || !expectedFile) throw new Error('PRIVATE_SEED_AND_EXPECTED_FILE_REQUIRED');
  const { readWeddingSeed } = await import('../src/features/wedding/defaults.ts');
  const seed = readWeddingSeed(file);
  const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
  const windows = seed.events.map(e => [e.id, new Date(e.startAt).toISOString(), e.endAt === null ? null : new Date(e.endAt).toISOString()]);
  const expectedWindows = expected.eventWindows.map(([id, start, end]) => [id, new Date(start).toISOString(), end === null ? null : new Date(end).toISOString()]);
  const storyMatches = typeof expected.story === 'string' ? seed.content.story.en === expected.story : isDeepStrictEqual(seed.content.story, expected.story);
  const familiesMatch = typeof expected.families === 'string' ? seed.content.families.en === expected.families : isDeepStrictEqual(seed.content.families, expected.families);
  const requiredSettings = ['newRsvpClosesAt', 'helpPhone', 'helpTelUrl', 'helpWhatsAppUrl'];
  const settingsMatch = requiredSettings.every(key => Object.hasOwn(expected.settings, key)) && Object.entries(expected.settings).every(([key, value]) => seed.settings[key] === value);
  if (!isDeepStrictEqual(windows, expectedWindows) || !storyMatches || !familiesMatch || !settingsMatch) throw new Error('PRIVATE_SEED_SPEC_MISMATCH');
  const test = args.includes('--test');
  const target = localDatabaseUrl(test ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL, test ? 'wedding_test' : 'wedding_dev');
  const service = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(service.hostname)) throw new Error('UNSAFE_STORAGE_TARGET');
  const client = createClient(service.href, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const db = postgres(target, { max: 1, onnotice: () => {} });
  try {
    const [identity] = await db`select current_database() as name, current_user as role`;
    if (identity.name !== (test ? 'wedding_test' : 'wedding_dev') || identity.role !== 'wedding_app') throw new Error('UNSAFE_LOCAL_DATABASE');
    await ensurePrivateBucket(client, test ? 'wedding-photos-test' : 'wedding-photos-dev');
    await writeWeddingSeed(db, seed);
    console.log('Private wedding content saved. No personal content was logged.');
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Wedding seed failed; check private input, local services and operator configuration.'); process.exitCode=1; });
