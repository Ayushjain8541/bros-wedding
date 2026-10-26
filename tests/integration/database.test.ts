import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CONTENT, EVENTS, SETTINGS } from '../fixtures/wedding';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from 'vitest';
import { readInvitation, readSettings } from '@/features/wedding/repository';
import { withTestDb, withTestAdmin, testDatabaseUrl } from '../helpers/database';

test('persists eight/six eligible events, source narrative and settings after migration replay', async () => {
  await withTestDb(async db => {
    const one = await readInvitation('group-1', db);
    const two = await readInvitation('group-2', db);
    expect(one.events).toHaveLength(8);
    expect(two.events).toHaveLength(6);
    expect(two.events.map(event => event.id)).not.toContain('mehendi');
    expect(two.events.map(event => event.id)).not.toContain('closing-dinner');
    expect(one.content.story.en).toBe("A sample story awaiting the family's approved private content.");
    expect(one.content.couple.displayName.en).toBe('Sample Bride & Sample Groom');
    expect(one.content.wedding.startDate).toBe('2030-02-12');
    expect(Object.getPrototypeOf(one.content.photos)).toBe(Array.prototype);
    expect(one.events[0].startAt).toBe('2030-02-12T10:30:00.000Z');
    expect((await readSettings(db)).maxPartySize).toBe(200);
    expect(one.settings.newRsvpClosesAt).toBe('2026-11-30T18:30:00.000Z');
    const [role] = await db`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(role).toEqual({ name: 'wedding_app', rolsuper: false, rolbypassrls: false });
    await expect(db`create table wedding.forbidden(id int)`).rejects.toMatchObject({ code: '42501' });
  });
  // A second clean replay must work without relying on the first schema or data.
  await withTestDb(async db => expect((await readInvitation('group-2', db)).events).toHaveLength(6));
});

test('denies anonymous and ordinary signed-in roles all private CRUD and function execution', async () => {
  await withTestDb(async () => {
    await withTestAdmin(async admin => {
      await admin.unsafe("create function wedding.privilege_probe() returns integer language sql as 'select 1'");
      const tables = await admin`select tablename from pg_tables where schemaname = 'wedding'`;
      expect(tables.length).toBeGreaterThanOrEqual(14);
      for (const role of ['anon', 'authenticated']) {
        for (const { tablename } of tables) {
          const [privileges] = await admin`select has_table_privilege(${role}, ${`wedding.${tablename}`}, 'SELECT, INSERT, UPDATE, DELETE') as allowed`;
          expect(privileges.allowed).toBe(false);
          for (const query of [`select * from wedding.${tablename}`, `insert into wedding.${tablename} default values`, `update wedding.${tablename} set ${tablename === 'site_settings' || tablename === 'website_content' ? 'singleton = singleton' : tablename === 'invitation_groups' || tablename === 'events' ? 'id = id' : tablename === 'event_groups' ? 'event_id = event_id' : tablename === 'organizer_users' ? 'user_id = user_id' : tablename === 'abuse_buckets' ? 'key_hash = key_hash' : 'id = id'}`, `delete from wedding.${tablename}`]) {
            await expect(admin.begin(async tx => { await tx.unsafe(`set local role ${role}`); await tx.unsafe(query); })).rejects.toMatchObject({ code: '42501' });
          }
        }
        const routines = await admin`select p.oid, has_function_privilege(${role}, p.oid, 'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='wedding'`;
        expect(routines).toHaveLength(1);
        expect(routines.every(row => !row.allowed)).toBe(true);
        await expect(admin.begin(async tx => { await tx.unsafe(`set local role ${role}`); await tx.unsafe('select wedding.privilege_probe()'); })).rejects.toMatchObject({ code: '42501' });
      }
      const protection = await admin`select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='wedding' and c.relkind='r'`;
      expect(protection.every(row => row.relrowsecurity && row.relforcerowsecurity && row.owner !== 'wedding_app')).toBe(true);
    });
  });
});

test('rejects invalid settings, event windows, orphan sessions and duplicate selections', async () => {
  await withTestDb(async db => {
    await expect(db`update wedding.site_settings set max_party_size=201`).rejects.toMatchObject({ code: '23514' });
    await expect(db`update wedding.events set end_at=start_at where id='haldi'`).rejects.toMatchObject({ code: '23514' });
    await expect(db`insert into wedding.guest_sessions(token_hash, group_id, expires_at) values(${ 'a'.repeat(64) }, 'missing', now()+interval '1 day')`).rejects.toMatchObject({ code: '23503' });
    await expect(db`insert into wedding.event_groups(event_id, group_id) values('haldi','group-2')`).rejects.toMatchObject({ code: '23505' });
    await expect(db`insert into wedding.invitation_groups(id, code_hash) values('group-3', ${'b'.repeat(64)})`).rejects.toMatchObject({ code: '23514' });
  });
});

test('provisions a private photo bucket on the real local Storage service', async () => {
  await withTestDb(async () => {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data, error } = await client.storage.getBucket('wedding-photos-test');
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
    const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const path = `task2/${randomUUID()}.png`;
    try {
      const uploaded = await client.storage.from('wedding-photos-test').upload(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64'), { contentType: 'image/png' });
      expect(uploaded.error).toBeNull();
      const result = await anonymous.storage.from('wedding-photos-test').download(path);
      expect(result.error).not.toBeNull();
      expect(result.data).toBeNull();
    } finally { await client.storage.from('wedding-photos-test').remove([path]); }
  });
});

test('refuses every destructive target except a loopback wedding_test database', () => {
  for (const url of ['postgres://x:y@example.com/wedding_test', 'postgres://x:y@127.0.0.1/postgres', 'postgres://x:y@127.0.0.1/wedding_dev', 'postgres://x:y@127.0.0.1/other_test', 'postgres://x:y@127.0.0.1/wedding_test?host=example.com']) expect(() => testDatabaseUrl(url)).toThrow('UNSAFE_TEST_DATABASE');
});


test('operator seeds validated content and rejects a changed narrative without logging it', async () => {
  await withTestDb(async db => {
    const dir = await mkdtemp(join(tmpdir(), 'wedding-seed-'));
    const file = join(dir, 'seed.json'), expected = join(dir, 'expected.json');
    const seed = { content: { ...CONTENT, revision: 2 }, events: EVENTS, settings: SETTINGS };
    try {
      await writeFile(file, JSON.stringify(seed));
      await writeFile(expected, JSON.stringify({ eventWindows: EVENTS.map(e => [e.id, e.startAt, e.endAt]), story: CONTENT.story, families: CONTENT.families, settings: SETTINGS }));
      const result = await promisify(execFile)(process.execPath, ['scripts/seed-content.mjs', '--file', file, '--expected', expected, '--test']);
      expect(result.stdout).toContain('Private wedding content saved');
      expect((await readInvitation('group-1', db)).content.revision).toBe(2);
      seed.content.story = { ...CONTENT.story, en: 'PRIVATE_INVALID_NARRATIVE' };
      await writeFile(file, JSON.stringify(seed));
      try {
        await promisify(execFile)(process.execPath, ['scripts/seed-content.mjs', '--file', file, '--expected', expected, '--test']);
        throw new Error('invalid seed was accepted');
      } catch (error) {
        expect((error as {code: number}).code).toBe(1);
        expect((error as {stderr: string}).stderr).not.toContain('PRIVATE_INVALID_NARRATIVE');
      }
      expect((await readInvitation('group-1', db)).content.story.en).toBe("A sample story awaiting the family's approved private content.");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('operator rotates a random code, stores only its hash and revokes earlier group sessions', async () => {
  await withTestDb(async db => {
    await db`insert into wedding.guest_sessions(group_id,token_hash,expires_at) values('group-1', ${'e'.repeat(64)}, now()+interval '1 day')`;
    const first = await promisify(execFile)(process.execPath, ['scripts/seed-access.mjs', '--group', 'group-1', '--test', '--print-link']);
    const code = new URL(first.stdout.trim()).hash.slice(1);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [group] = await db`select code_hash from wedding.invitation_groups where id='group-1'`;
    expect(group.code_hash).toBe(createHash('sha256').update(code).digest('hex'));
    const [session] = await db`select revoked_at from wedding.guest_sessions where token_hash=${'e'.repeat(64)}`;
    expect(session.revoked_at).toBeInstanceOf(Date);
    const second = await promisify(execFile)(process.execPath, ['scripts/seed-access.mjs', '--group', 'group-1', '--test']);
    expect(second.stdout).not.toContain('/invite#');
    const [rotated] = await db`select code_hash from wedding.invitation_groups where id='group-1'`;
    expect(rotated.code_hash).not.toBe(group.code_hash);
  });
});


test('relational RSVP constraints prevent cross-group selections, duplicate guests and unbounded travel', async () => {
  await withTestDb(async db => {
    const [party] = await db`insert into wedding.rsvp_submissions(group_id, request_id, payload_fingerprint, edit_token_hash, decision, contact_full_name, contact_name_normalized, contact_phone, arrival_date, arrival_window, departure_date, departure_window) values ('group-2', gen_random_uuid(), ${'a'.repeat(64)}, ${'b'.repeat(64)}, 'accept', 'Asha Jain', 'asha jain', '+12025550123', '2027-02-12', 'noon-5pm', '2027-02-14', 'before-noon') returning id`;
    await expect(db`insert into wedding.rsvp_event_selections(submission_id,event_id,group_id) values(${party.id}, 'mehendi', 'group-2')`).rejects.toMatchObject({ code: '23503' });
    await expect(db`insert into wedding.rsvp_event_selections(submission_id,event_id,group_id) values(${party.id}, 'haldi', 'group-1')`).rejects.toMatchObject({ code: '23503' });
    await db`insert into wedding.rsvp_event_selections(submission_id,event_id,group_id) values(${party.id}, 'haldi', 'group-2')`;
    await expect(db`insert into wedding.rsvp_event_selections(submission_id,event_id,group_id) values(${party.id}, 'haldi', 'group-2')`).rejects.toMatchObject({ code: '23505' });
    await expect(db`delete from wedding.events where id='haldi'`).rejects.toMatchObject({ code: '23503' });
    await db`insert into wedding.rsvp_guests(submission_id,full_name,position) values(${party.id}, 'Asha Jain', 0)`;
    await expect(db`insert into wedding.rsvp_guests(submission_id,full_name,position) values(${party.id}, 'Ravi Jain', 0)`).rejects.toMatchObject({ code: '23505' });
    await expect(db`update wedding.rsvp_submissions set departure_date=arrival_date, departure_window='before-noon' where id=${party.id}`).rejects.toMatchObject({ code: '23514' });
    await db`update wedding.rsvp_submissions set departure_date=arrival_date+366 where id=${party.id}`;
    await expect(db`update wedding.rsvp_submissions set departure_date=arrival_date+367 where id=${party.id}`).rejects.toMatchObject({ code: '23514' });
    await expect(db`update wedding.rsvp_submissions set song_name='Sample song' where id=${party.id}`).rejects.toMatchObject({ code: '23514' });
    await expect(db`update wedding.rsvp_submissions set decision='decline' where id=${party.id}`).rejects.toMatchObject({ code: '23514' });
    await expect(readInvitation('invalid' as 'group-1', db)).rejects.toMatchObject({ code: 'INVALID_GROUP' });
  });
});
