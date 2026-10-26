import 'server-only';
import { createHmac } from 'node:crypto';
import type { Database } from '@/lib/db/server';
import { readEnv } from '@/lib/env';
import { DomainError } from '@/lib/errors';

/** Atomic durable first-attempt-anchored windows; raw network identifiers never persist. */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number, db: Database): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) throw new DomainError('INVALID_RATE_LIMIT', 500);
  const keyHash = createHmac('sha256', readEnv().RATE_LIMIT_HMAC_KEY).update(key).digest('hex');
  const [bucket] = await db`
    insert into wedding.abuse_buckets(key_hash, count, window_start, expires_at)
    values(${keyHash}, 1, statement_timestamp(), statement_timestamp() + ${windowSeconds} * interval '1 second')
    on conflict(key_hash) do update set
      count=case when wedding.abuse_buckets.expires_at <= statement_timestamp() then 1 else least(wedding.abuse_buckets.count + 1, ${limit + 1}) end,
      window_start=case when wedding.abuse_buckets.expires_at <= statement_timestamp() then statement_timestamp() else wedding.abuse_buckets.window_start end,
      expires_at=case when wedding.abuse_buckets.expires_at <= statement_timestamp() then statement_timestamp() + ${windowSeconds} * interval '1 second' else wedding.abuse_buckets.expires_at end
    returning count
  `;
  if (bucket.count > limit) throw new DomainError('RATE_LIMITED', 429);
}
