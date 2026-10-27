import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { createRsvp, readOwnRsvp, updateRsvp } from '@/features/rsvp/service';
import { hashToken } from '@/features/rsvp/token';
import { findDuplicateGroups } from '@/features/rsvp/duplicates';
import type { EditorActor, OrganizerActor, PartySnapshot } from '@/features/wedding/types';
import { acceptedInput, declinedInput } from '../fixtures/wedding';
import { createPartyFixture, seedGuestSession, withTestAdmin, withTestDb } from '../helpers/database';
const command = () => ({ requestId: randomUUID(), editToken: randomBytes(32).toString('base64url'), response: acceptedInput() });
async function open(db: Parameters<typeof createRsvp>[3]) { await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()+interval '1 day'`; }
async function editor(id: string, groupId: EditorActor['groupId'], guestSessionId: string, db: Parameters<typeof createRsvp>[3]): Promise<EditorActor> {
  const [row] = await db`insert into wedding.edit_sessions(submission_id,token_hash,expires_at) values(${id},${hashToken(randomBytes(32).toString('base64url'))},clock_timestamp()+interval '1 day') returning id`;
  return { kind: 'editor', submissionId: id, groupId, sessionId: row.id, guestSessionId };
}
describe('atomic RSVP services on restricted Postgres', () => {
  it('creates and reloads three guests; matching retries preserve identity, token hash and response', async () => withTestDb(async db => {
    await open(db); const { actor } = await seedGuestSession('group-1', db); const input = command();
    const first = await createRsvp(actor, 'group-1', input, db);
    expect(first).toMatchObject({version:1, duplicateWarning:false, editPath:`/rsvp/edit#${input.editToken}`});
    expect(await createRsvp(actor, 'group-1', input, db)).toEqual(first);
    const own = await readOwnRsvp(await editor(first.id,'group-1',actor.sessionId,db), db);
    expect(own.response).toEqual(input.response);
    const [counts] = await db`select (select count(*)::int from wedding.rsvp_submissions) parties, (select count(*)::int from wedding.rsvp_guests) guests`;
    expect(counts).toEqual({ parties:1, guests:3 });
    const [stored] = await db`select edit_token_hash from wedding.rsvp_submissions`;
    expect(stored.edit_token_hash).toBe(hashToken(input.editToken));
    await expect(createRsvp(actor,'group-1',{...input,response:declinedInput()},db)).rejects.toMatchObject({code:'idempotency_conflict',status:409});
    await expect(createRsvp(actor,'group-1',{...input,editToken:command().editToken},db)).rejects.toMatchObject({status:409});
    await updateRsvp(await editor(first.id,'group-1',actor.sessionId,db),first.id,{expectedVersion:1,response:declinedInput()},db);
    await createRsvp(actor,'group-1',command(),db);
    expect(await createRsvp(actor,'group-1',input,db)).toEqual(first);
    await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()-interval '1 day'`;
    await db`update wedding.events set cancelled=true where id='haldi'`;
    expect(await createRsvp(actor,'group-1',input,db)).toEqual(first);
    await expect(createRsvp(actor,'group-1',command(),db)).rejects.toMatchObject({code:'closed',status:403});
  }));
  it('scopes request IDs by group and serializes concurrent identical creates', async () => withTestDb(async db => {
    await open(db); const a = await seedGuestSession('group-1',db), b = await seedGuestSession('group-2',db); const input=command();
    const other=postgres(process.env.TEST_DATABASE_URL!, {max:1});
    try {
      const results=await Promise.all([createRsvp(a.actor,'group-1',input,db),createRsvp(a.actor,'group-1',input,other)]);
      expect(results[0]).toEqual(results[1]);
      const second=await createRsvp(b.actor,'group-2',{...input,editToken:command().editToken},db);
      expect(second.id).not.toBe(results[0].id); expect(second.duplicateWarning).toBe(true);
    } finally { await other.end(); }
  }));
  it('rejects inactive/mismatched actors, guest overrides, and unavailable events without persistence', async () => withTestDb(async db => {
    await open(db); const {actor}=await seedGuestSession('group-2',db);
    await expect(createRsvp(actor,'group-1',command(),db)).rejects.toMatchObject({status:403});
    await expect(createRsvp(actor,'group-2',command(),db,{reason:'Phone response',source:'phone'})).rejects.toMatchObject({status:403});
    await expect(createRsvp(actor,'group-2',{...command(),response:acceptedInput({eventIds:['mehendi']})},db)).rejects.toMatchObject({code:'forbidden_event',status:422});
    await expect(createRsvp(actor,'group-2',{...command(),response:acceptedInput({eventIds:[]})},db)).rejects.toMatchObject({status:422});
    await db`update wedding.events set cancelled=true where id='haldi'`;
    await expect(createRsvp(actor,'group-2',command(),db)).rejects.toMatchObject({code:'forbidden_event'});
    await db`update wedding.guest_sessions set revoked_at=clock_timestamp()`;
    await expect(createRsvp(actor,'group-2',command(),db)).rejects.toMatchObject({status:403});
    expect((await db`select id from wedding.rsvp_submissions`).length).toBe(0);
  }));
  it('rolls back parent, children, and organizer audit after an injected child write failure', async () => withTestDb(async db => {
    await open(db); await seedGuestSession('group-1',db);
    await withTestAdmin(async admin => { await admin.unsafe("alter table wedding.rsvp_guests add constraint injected_failure check(full_name <> 'Neha Jain')"); });
    const organizer:OrganizerActor={kind:'organizer',userId:randomUUID()};
    await db`insert into wedding.organizer_users(user_id) values(${organizer.userId})`;
    await expect(createRsvp(organizer,'group-1',command(),db,{reason:'Synthetic phone response',source:'phone'})).rejects.toMatchObject({code:'23514'});
    for (const table of ['rsvp_submissions','rsvp_guests','rsvp_event_selections','audit_log']) expect((await db.unsafe(`select * from wedding.${table}`)).length).toBe(0);
  }));
  it('edits preserve IDs, replace children, clear acceptance data and reject stale versions', async () => withTestDb(async db => {
    await open(db); const {actor,party}=await createPartyFixture('group-1',db);
    const one=acceptedInput({guestNames:['Asha Jain'],song:{name:'Synthetic Song',artist:'Synthetic Artist'},questions:'Hello'});
    expect(await updateRsvp(actor,party.id,{expectedVersion:1,response:one},db)).toMatchObject({id:party.id,version:2});
    expect((await readOwnRsvp(actor,db)).response).toEqual(one);
    expect((await db`select * from wedding.rsvp_guests`).length).toBe(1);
    await expect(updateRsvp(actor,party.id,{expectedVersion:1,response:declinedInput()},db)).rejects.toMatchObject({code:'conflict',status:409});
    await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()-interval '1 day'`;
    await updateRsvp(actor,party.id,{expectedVersion:2,response:declinedInput()},db);
    expect((await readOwnRsvp(actor,db)).response).toEqual(declinedInput());
    expect(await db`select * from wedding.rsvp_guests`).toHaveLength(0); expect(await db`select * from wedding.rsvp_event_selections`).toHaveLength(0);
    const [row]=await db`select arrival_date,song_name,questions from wedding.rsvp_submissions where id=${party.id}`;
    expect(row).toEqual({arrival_date:null,song_name:null,questions:null});
  }));
  it('locks competing edits so exactly one expectedVersion succeeds; failed replacement restores original', async () => withTestDb(async db => {
    await open(db); const {actor,party}=await createPartyFixture('group-1',db); const other=postgres(process.env.TEST_DATABASE_URL!,{max:1});
    try {
      const results=await Promise.allSettled([updateRsvp(actor,party.id,{expectedVersion:1,response:declinedInput()},db),updateRsvp(actor,party.id,{expectedVersion:1,response:acceptedInput({guestNames:['Ravi Jain']})},other)]);
      expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
      expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{status:409}});
    } finally {await other.end();}
    const before=await readOwnRsvp(actor,db);
    await withTestAdmin(async admin=>{await admin.unsafe("alter table wedding.rsvp_guests add constraint injected_failure check(full_name <> 'Neha Jain')");});
    await expect(updateRsvp(actor,party.id,{expectedVersion:2,response:acceptedInput()},db)).rejects.toMatchObject({code:'23514'});
    expect(await readOwnRsvp(actor,db)).toEqual(before);
  }));
  it('blocks cross-party reads/edits and revoked editor sessions; preserves cancelled selections until edited', async () => withTestDb(async db => {
    await open(db); const {actor,party}=await createPartyFixture('group-1',db);
    const second=await createRsvp({kind:'guest',groupId:'group-1',sessionId:actor.guestSessionId},'group-1',command(),db);
    await expect(updateRsvp(actor,second.id,{expectedVersion:1,response:declinedInput()},db)).rejects.toMatchObject({status:403});
    await expect(readOwnRsvp({...actor,submissionId:second.id},db)).rejects.toMatchObject({status:403});
    await expect(readOwnRsvp({...actor,groupId:'group-2'},db)).rejects.toMatchObject({status:403});
    await expect(readOwnRsvp({...actor,guestSessionId:undefined} as unknown as EditorActor,db)).rejects.toMatchObject({status:403});
    await expect(readOwnRsvp({...actor,guestSessionId:randomUUID()},db)).rejects.toMatchObject({status:403});
    const foreignGuest=await seedGuestSession('group-2',db);
    await expect(readOwnRsvp({...actor,guestSessionId:foreignGuest.actor.sessionId},db)).rejects.toMatchObject({status:403});
    await db`update wedding.events set cancelled=true where id='haldi'`;
    expect((await readOwnRsvp(actor,db)).response).toMatchObject({eventIds:['haldi']});
    await expect(updateRsvp(actor,party.id,{expectedVersion:1,response:acceptedInput()},db)).rejects.toMatchObject({code:'forbidden_event'});
    await updateRsvp(actor,party.id,{expectedVersion:1,response:declinedInput()},db);
    await db`update wedding.edit_sessions set revoked_at=clock_timestamp()`;
    await expect(readOwnRsvp(actor,db)).rejects.toMatchObject({status:403});
  }));
  it('rejects expired and rotated guest sessions, expired editors, and disabled groups', async () => withTestDb(async db => {
    await open(db); const {actor,party}=await createPartyFixture('group-1',db);
    await db`update wedding.edit_sessions set expires_at=clock_timestamp()-interval '1 day',created_at=clock_timestamp()-interval '2 days' where id=${actor.sessionId}`;
    await expect(readOwnRsvp(actor,db)).rejects.toMatchObject({status:403});
    const {actor:guest}=await seedGuestSession('group-1',db);
    await db`update wedding.guest_sessions set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=${guest.sessionId}`;
    await expect(createRsvp(guest,'group-1',command(),db)).rejects.toMatchObject({status:403});
    const current=await seedGuestSession('group-1',db);
    await db`update wedding.invitation_groups set rotated_at=clock_timestamp()+interval '1 second' where id='group-1'`;
    await expect(createRsvp(current.actor,'group-1',command(),db)).rejects.toMatchObject({status:403});
    await db`update wedding.invitation_groups set code_hash=null where id='group-1'`;
    const organizer:OrganizerActor={kind:'organizer',userId:randomUUID()}; await db`insert into wedding.organizer_users(user_id) values(${organizer.userId})`;
    await expect(updateRsvp(organizer,party.id,{expectedVersion:1,response:declinedInput()},db)).rejects.toMatchObject({status:403});
  }));
  it('requires a real allowlisted organizer, reason and source to override cutoff and audits the save', async () => withTestDb(async db => {
    await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()-interval '1 day'`;
    const actor:OrganizerActor={kind:'organizer',userId:randomUUID()};
    await expect(createRsvp(actor,'group-1',command(),db,{reason:'Recorded by phone',source:'phone'})).rejects.toMatchObject({status:403});
    await db`insert into wedding.organizer_users(user_id) values(${actor.userId})`;
    await seedGuestSession('group-1',db);
    await expect(createRsvp(actor,'group-1',command(),db)).rejects.toMatchObject({code:'closed'});
    await expect(createRsvp(actor,'group-1',command(),db,{reason:' ',source:'phone'})).rejects.toMatchObject({status:422});
    const saved=await createRsvp(actor,'group-1',command(),db,{reason:'Recorded by phone',source:'phone'});
    const [row]=await db`select source from wedding.rsvp_submissions where id=${saved.id}`; expect(row.source).toBe('phone');
    const [audit]=await db`select organizer_user_id,reason,details from wedding.audit_log where submission_id=${saved.id}`;
    expect(audit).toMatchObject({organizer_user_id:actor.userId,reason:'Recorded by phone',details:{source:'phone',deadlineOverride:true}});
    await updateRsvp(actor,saved.id,{expectedVersion:1,response:declinedInput()},db);
    expect(await db`select * from wedding.audit_log where submission_id=${saved.id}`).toHaveLength(2);
  }));
});
it('duplicates match only normalized primary contact phone or full name without merging',()=>{
  const party=(id:string,name:string,phone:string):PartySnapshot=>({id,groupId:'group-1',version:1,source:'website',response:{decision:'decline',contact:{fullName:name,whatsapp:phone}}});
  const parties=[party('a',' Asha  Jain ','+1 (202) 555-0123'),party('b','Ravi Jain','+12025550123'),party('c','asha jain','+12025550124'),party('d','Neha Jain','+12025550125')];
  expect(findDuplicateGroups(parties)).toEqual([{submissionIds:['a','b'],reason:'contact'},{submissionIds:['a','c'],reason:'name'}]);
});

// A previously verified editor must still possess its original guest authority at the read/write boundary.
it.each(['expired','revoked','rotated'] as const)('rejects an editor whose original guest became %s before service authorization', async mode => withTestDb(async db => {
  const {actor,party}=await createPartyFixture('group-1',db);
  const [guest]=await db`select id from wedding.guest_sessions where group_id='group-1'`;
  if(mode==='expired') await db`update wedding.guest_sessions set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=${guest.id}`;
  else if(mode==='revoked') await db`update wedding.guest_sessions set revoked_at=clock_timestamp() where id=${guest.id}`;
  else await db`update wedding.invitation_groups set rotated_at=clock_timestamp() where id='group-1'`;
  await expect(readOwnRsvp(actor,db)).rejects.toMatchObject({status:403});
  await expect(updateRsvp(actor,party.id,{expectedVersion:1,response:declinedInput()},db)).rejects.toMatchObject({status:403});
  expect((await db`select version,decision from wedding.rsvp_submissions where id=${party.id}`)[0]).toEqual({version:1,decision:'accept'});
  expect(await db`select * from wedding.rsvp_guests`).toHaveLength(3);
  expect(await db`select * from wedding.rsvp_event_selections`).toHaveLength(1);
}));
