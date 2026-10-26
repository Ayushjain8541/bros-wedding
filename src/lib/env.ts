import 'server-only';
import { z } from 'zod';
import { DomainError } from './errors';

const origin = z.url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password;
});
const database = z.string().refine(value => {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && decodeURIComponent(url.username) === 'wedding_app' && !!url.hostname && url.pathname.length > 1 && !url.search && !url.hash;
  } catch { return false; }
});
const schema = z.object({
  DATABASE_URL: database,
  APP_ORIGIN: origin,
  NEXT_PUBLIC_SUPABASE_URL: origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  RATE_LIMIT_HMAC_KEY: z.string().min(32),
});
export function readEnv(source: Record<string, string | undefined> = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) throw new DomainError('INVALID_SERVER_CONFIGURATION', 500);
  return result.data;
}
