import 'server-only';
import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import type { Database } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import type { EditorActor, GuestActor } from '@/features/wedding/types';
import { hashToken } from './token';

const opaque = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unauthenticated = () => new DomainError('ACCESS_DENIED', 401);

/** Revalidate adapter inputs and hold group/session locks through session issuance. */
async function verifyGuest(guest: GuestActor, tx: postgres.TransactionSql) {
  if (guest?.kind !== 'guest' || !['group-1', 'group-2'].includes(guest.groupId) || !uuid.test(guest.sessionId)) throw unauthenticated();
  const [live] = await tx`
    select s.id from wedding.guest_sessions s
    join wedding.invitation_groups g on g.id=s.group_id
    where s.id=${guest.sessionId} and s.group_id=${guest.groupId}
      and s.revoked_at is null and s.expires_at>clock_timestamp()
      and s.created_at>=g.rotated_at and g.code_hash is not null
    for share of s,g
  `;
  if (!live) throw unauthenticated();
}

export async function exchangeEditToken(token: string, guest: GuestActor, db: Database): Promise<{ sessionToken: string; expiresAt: string }> {
  if (typeof token !== 'string' || !opaque.test(token)) throw new DomainError('forbidden', 403);
  return db.begin(async tx => {
    await verifyGuest(guest, tx);
    const [party] = await tx`select id,group_id from wedding.rsvp_submissions where edit_token_hash=${hashToken(token)} for share`;
    if (!party || party.group_id !== guest.groupId) throw new DomainError('forbidden', 403);
    const sessionToken = randomBytes(32).toString('base64url');
    const [session] = await tx`
      insert into wedding.edit_sessions(submission_id,token_hash,created_at,expires_at)
      select ${party.id},${hashToken(sessionToken)},issued_at,issued_at + interval '24 hours'
      from (select clock_timestamp() as issued_at) issued
      returning expires_at
    `;
    return { sessionToken, expiresAt: session.expires_at.toISOString() };
  });
}

export async function requireEditor(editCookie: string | undefined, guest: GuestActor, db: Database): Promise<EditorActor> {
  if (!editCookie || !opaque.test(editCookie)) throw unauthenticated();
  return db.begin(async tx => {
    await verifyGuest(guest, tx);
    const [session] = await tx`
      select e.id,e.submission_id,r.group_id from wedding.edit_sessions e
      join wedding.rsvp_submissions r on r.id=e.submission_id
      where e.token_hash=${hashToken(editCookie)} and e.revoked_at is null
        and e.expires_at>clock_timestamp()
      for share of e,r
    `;
    if (!session) throw unauthenticated();
    if (session.group_id !== guest.groupId) throw new DomainError('forbidden', 403);
    return { kind: 'editor', groupId: session.group_id, submissionId: session.submission_id, sessionId: session.id };
  });
}
