import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import type { GuestActor } from '@/features/wedding/types';

const opaqueToken = /^[A-Za-z0-9_-]{43}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = () => new DomainError('ACCESS_DENIED', 401);

export async function requireGuest(cookie: string | undefined, db: Database): Promise<GuestActor> {
  if (!cookie || !opaqueToken.test(cookie)) throw denied();
  const [session] = await db`
    select s.id, s.group_id from wedding.guest_sessions s
    join wedding.invitation_groups g on g.id=s.group_id
    where s.token_hash=${digest(cookie)} and s.revoked_at is null
      and s.expires_at > clock_timestamp() and s.created_at >= g.rotated_at
      and g.code_hash is not null
  `;
  if (!session) throw denied();
  return { kind: 'guest', groupId: session.group_id, sessionId: session.id };
}

export async function exchangeGroupCode(code: string, db: Database): Promise<{ sessionToken: string; expiresAt: string }> {
  if (!opaqueToken.test(code)) throw denied();
  return db.begin(async tx => {
    // Rotation updates this same row. At READ COMMITTED, PostgreSQL rechecks the
    // hash after a competing update commits; keep the lock until session insert.
    const [group] = await tx`select id from wedding.invitation_groups where code_hash=${digest(code)} for update`;
    if (!group) throw denied();
    const sessionToken = randomBytes(32).toString('base64url');
    const [session] = await tx`
      insert into wedding.guest_sessions(group_id, token_hash, created_at, expires_at)
      select ${group.id}, ${digest(sessionToken)}, issued_at, issued_at + interval '30 days'
      from (select clock_timestamp() as issued_at) issued
      returning expires_at
    `;
    return { sessionToken, expiresAt: session.expires_at.toISOString() };
  });
}
