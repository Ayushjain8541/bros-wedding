import 'server-only';
import { createHash } from 'node:crypto';
/** Only digests cross the persistence boundary; raw editor tokens remain with the guest. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
