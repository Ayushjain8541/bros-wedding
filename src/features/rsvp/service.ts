import 'server-only';
import type postgres from 'postgres';
import type { CreateCommand, EditCommand, EditorActor, EventId, GroupId, GuestActor, OrganizerActor, PartySnapshot, RsvpInput, SaveResult, TimeWindow, ValidatedRsvp } from '@/features/wedding/types';
import type { Database } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { findDuplicateGroups, normalizeContactName } from './duplicates';
import { hashToken } from './token';
import { validateRsvp } from './validation';

type Tx = postgres.TransactionSql;
type Override = {reason?:string; source:'whatsapp'|'phone'};
interface Submission {
  id:string; group_id:GroupId; version:number; payload_fingerprint:string; edit_token_hash:string; original_duplicate_warning:boolean;
  decision:'accept'|'decline'; contact_full_name:string; contact_phone:string;
  arrival_date:string|null; arrival_window:TimeWindow|null; departure_date:string|null; departure_window:TimeWindow|null;
  song_name:string|null; song_artist:string|null; song_url:string|null; questions:string|null; note:string|null;
  source:'website'|'whatsapp'|'phone';
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = () => new DomainError('forbidden',403);
const invalid = () => new DomainError('VALIDATION_FAILED',422,{_form:['invalid_type']});
function assertUuid(value:unknown):asserts value is string { if (typeof value !== 'string' || !uuid.test(value)) throw denied(); }
function canonical(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function settings(tx:Tx) {
  const [row] = await tx`select max_party_size,new_rsvp_closes_at from wedding.site_settings where singleton for update`;
  if (!row) throw new DomainError('SETTINGS_UNAVAILABLE',503);
  return row;
}
async function authorize(actor:GuestActor|EditorActor|OrganizerActor, groupId:GroupId, tx:Tx, submissionId?:string) {
  const [group] = await tx`select id,rotated_at from wedding.invitation_groups where id=${groupId} and code_hash is not null for share`;
  if (!group) throw denied();
  if (actor.kind === 'organizer') {
    assertUuid(actor.userId);
    const [organizer] = await tx`select user_id from wedding.organizer_users where user_id=${actor.userId} for share`;
    if (!organizer) throw denied();
    return;
  }
  if (actor.groupId !== groupId) throw denied();
  assertUuid(actor.sessionId);
  if (actor.kind === 'guest') {
    const [session] = await tx`select id from wedding.guest_sessions where id=${actor.sessionId} and group_id=${groupId} and revoked_at is null and expires_at>clock_timestamp() and created_at>=${group.rotated_at} for share`;
    if (!session) throw denied();
  } else if (actor.kind === 'editor' && submissionId && actor.submissionId===submissionId) {
    // Adapter authentication can precede a slow HTTP body. Revalidate both
    // credentials here and retain group/guest/editor locks through read or save.
    assertUuid(actor.guestSessionId);
    const [guest] = await tx`select id from wedding.guest_sessions where id=${actor.guestSessionId} and group_id=${groupId} and revoked_at is null and expires_at>clock_timestamp() and created_at>=${group.rotated_at} for share`;
    if (!guest) throw denied();
    const [session] = await tx`select id from wedding.edit_sessions where id=${actor.sessionId} and submission_id=${submissionId} and revoked_at is null and expires_at>clock_timestamp() for share`;
    if (!session) throw denied();
  } else throw denied();
}
async function eligible(tx:Tx, groupId:GroupId):Promise<EventId[]> {
  const rows=await tx<{id:EventId}[]>`select e.id from wedding.events e join wedding.event_groups g on g.event_id=e.id where g.group_id=${groupId} and not e.cancelled for share of e,g`;
  return rows.map(row=>row.id);
}
function validate(input:RsvpInput, ids:EventId[], max:number):ValidatedRsvp {
  try {return validateRsvp(input,ids,max);}
  catch(error) {
    if (error instanceof DomainError && Object.values(error.fieldErrors ?? {}).some(codes=>codes.includes('unauthorized_event'))) throw new DomainError('forbidden_event',422,error.fieldErrors);
    throw error;
  }
}
function values(response:ValidatedRsvp) {
  const accepted=response.decision==='accept' ? response : undefined;
  return { decision:response.decision, contact_full_name:response.contact.fullName, contact_name_normalized:normalizeContactName(response.contact.fullName), contact_phone:response.contact.whatsapp,
    arrival_date:accepted?.travel.arrivalDate ?? null, arrival_window:accepted?.travel.arrivalWindow ?? null,
    departure_date:accepted?.travel.departureDate ?? null, departure_window:accepted?.travel.departureWindow ?? null,
    song_name:accepted?.song?.name ?? null,song_artist:accepted?.song?.artist ?? null,song_url:accepted?.song?.url ?? null,
    questions:accepted?.questions ?? null,note:response.decision==='decline' ? response.note ?? null : null };
}
async function replaceChildren(id:string, groupId:GroupId, response:ValidatedRsvp, tx:Tx) {
  await tx`delete from wedding.rsvp_guests where submission_id=${id}`;
  await tx`delete from wedding.rsvp_event_selections where submission_id=${id}`;
  if (response.decision==='accept') {
    await tx`insert into wedding.rsvp_guests ${tx(response.guestNames.map((full_name,position)=>({submission_id:id,full_name,position})))}`;
    await tx`insert into wedding.rsvp_event_selections ${tx(response.eventIds.map(event_id=>({submission_id:id,event_id,group_id:groupId})))}`;
  }
}
async function duplicateWarning(id:string, tx:Tx):Promise<boolean> {
  const rows=await tx<{id:string;group_id:GroupId;contact_full_name:string;contact_phone:string}[]>`select id,group_id,contact_full_name,contact_phone from wedding.rsvp_submissions order by created_at,id`;
  const parties:PartySnapshot[]=rows.map(row=>({id:row.id,groupId:row.group_id,version:1,source:'website',response:{decision:'decline',contact:{fullName:row.contact_full_name,whatsapp:row.contact_phone}}}));
  return findDuplicateGroups(parties).some(group=>group.submissionIds.includes(id));
}
async function audit(actor:OrganizerActor,id:string,action:string,tx:Tx,override?:Override,deadlineOverride=false,source:Submission['source']=override?.source ?? 'website') {
  await tx`insert into wedding.audit_log(organizer_user_id,submission_id,action,reason,details) values(${actor.userId},${id},${action},${override?.reason?.trim() || null},${tx.json({source,deadlineOverride})})`;
}
/** Retry identity is immutable even if the saved party has subsequently been edited. */
export async function createRsvp(actor:GuestActor|OrganizerActor,groupId:GroupId,command:CreateCommand,db:Database,override?:Override):Promise<SaveResult> {
  if (actor.kind!=='guest' && actor.kind!=='organizer') throw denied();
  if (override && actor.kind!=='organizer') throw denied();
  if (!command || !uuid.test(command.requestId) || !/^[A-Za-z0-9_-]{43}$/.test(command.editToken)) throw invalid();
  if (override && ((override.reason!==undefined && (typeof override.reason!=='string' || override.reason.length>2000)) || !['phone','whatsapp'].includes(override.source))) throw invalid();
  return db.begin(async tx=>{
    const config=await settings(tx);
    await authorize(actor,groupId,tx);
    // Validate structure/normalization for fingerprint independently of mutable eligibility/limits.
    const allIds=await tx<{id:EventId}[]>`select id from wedding.events`;
    const normalized=validate(command.response,allIds.map(row=>row.id),200);
    const fingerprint=hashToken(canonical({response:normalized,override:override ? {source:override.source,reason:override.reason?.trim() || null} : null}));
    const tokenHash=hashToken(command.editToken);
    const [existing]=await tx<Submission[]>`select * from wedding.rsvp_submissions where group_id=${groupId} and request_id=${command.requestId} for update`;
    if (existing) {
      if (existing.payload_fingerprint!==fingerprint || existing.edit_token_hash!==tokenHash) throw new DomainError('idempotency_conflict',409);
      return {id:existing.id,version:1,duplicateWarning:existing.original_duplicate_warning,editPath:`/rsvp/edit#${command.editToken}`};
    }
    const [{closed}]=await tx<{closed:boolean}[]>`select clock_timestamp() >= ${config.new_rsvp_closes_at} as closed`;
    if (closed && !override?.reason?.trim()) throw new DomainError('closed',403);
    const response=validate(normalized,await eligible(tx,groupId),config.max_party_size);
    const [saved]=await tx<{id:string}[]>`insert into wedding.rsvp_submissions ${tx({...values(response),group_id:groupId,request_id:command.requestId,payload_fingerprint:fingerprint,edit_token_hash:tokenHash,source:override?.source ?? 'website'})} on conflict(edit_token_hash) do nothing returning id`;
    if (!saved) throw new DomainError('idempotency_conflict',409);
    await replaceChildren(saved.id,groupId,response,tx);
    const warning=await duplicateWarning(saved.id,tx);
    await tx`update wedding.rsvp_submissions set original_duplicate_warning=${warning} where id=${saved.id}`;
    if (actor.kind==='organizer') await audit(actor,saved.id,'rsvp.create',tx,override,closed);
    return {id:saved.id,version:1,duplicateWarning:warning,editPath:`/rsvp/edit#${command.editToken}`};
  });
}
export async function updateRsvp(actor:EditorActor|OrganizerActor,submissionId:string,command:EditCommand,db:Database):Promise<SaveResult> {
  if (actor.kind!=='editor' && actor.kind!=='organizer') throw denied();
  assertUuid(submissionId);
  if (!command || typeof command.expectedSubmissionId !== 'string' || !uuid.test(command.expectedSubmissionId) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion<1) throw invalid();
  return db.begin(async tx=>{
    const config=await settings(tx);
    const [row]=await tx<Submission[]>`select * from wedding.rsvp_submissions where id=${submissionId} for update`;
    if (!row) throw denied();
    await authorize(actor,row.group_id,tx,submissionId);
    // Caller identity is a precondition only: the authenticated actor selected this row.
    if (row.id!==command.expectedSubmissionId.toLowerCase() || row.version!==command.expectedVersion) throw new DomainError('conflict',409);
    const response=validate(command.response,await eligible(tx,row.group_id),config.max_party_size);
    await tx`update wedding.rsvp_submissions set ${tx(values(response))},version=version+1,updated_at=clock_timestamp() where id=${submissionId}`;
    await replaceChildren(submissionId,row.group_id,response,tx);
    if (actor.kind==='organizer') await audit(actor,submissionId,'rsvp.update',tx,undefined,false,row.source);
    return {id:submissionId,version:row.version+1,duplicateWarning:await duplicateWarning(submissionId,tx)};
  });
}
export async function readOwnRsvp(actor:EditorActor,db:Database):Promise<PartySnapshot> {
  if (actor.kind!=='editor') throw denied();
  assertUuid(actor.submissionId);
  return db.begin(async tx=>{
    const [row]=await tx<Submission[]>`select *,to_char(arrival_date,'YYYY-MM-DD') as arrival_date,to_char(departure_date,'YYYY-MM-DD') as departure_date from wedding.rsvp_submissions where id=${actor.submissionId} for share`;
    if (!row) throw denied();
    await authorize(actor,row.group_id,tx,row.id);
    const contact={fullName:row.contact_full_name,whatsapp:row.contact_phone};
    let response:ValidatedRsvp;
    if (row.decision==='decline') response={decision:'decline',contact,...(row.note===null ? {} : {note:row.note})};
    else {
      const names=await tx<{full_name:string}[]>`select full_name from wedding.rsvp_guests where submission_id=${row.id} order by position`;
      const events=await tx<{event_id:EventId}[]>`select s.event_id from wedding.rsvp_event_selections s join wedding.events e on e.id=s.event_id where s.submission_id=${row.id} order by e.start_at,e.id`;
      response={decision:'accept',contact,guestNames:names.map(name=>name.full_name),eventIds:events.map(event=>event.event_id),travel:{arrivalDate:row.arrival_date!,arrivalWindow:row.arrival_window!,departureDate:row.departure_date!,departureWindow:row.departure_window!},
        ...(row.song_name!==null && row.song_artist!==null ? {song:{name:row.song_name,artist:row.song_artist,...(row.song_url===null ? {} : {url:row.song_url})}} : {}),...(row.questions===null ? {} : {questions:row.questions})};
    }
    return {id:row.id,groupId:row.group_id,version:row.version,response,source:row.source};
  });
}
