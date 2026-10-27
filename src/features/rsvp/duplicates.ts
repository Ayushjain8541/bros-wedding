import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { PartySnapshot } from '@/features/wedding/types';
export const normalizeContactName = (name: string): string => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
/** Deliberately compare primary contacts only; household guest names never imply a duplicate. */
export function findDuplicateGroups(parties: readonly PartySnapshot[]): { submissionIds: string[]; reason: 'contact' | 'name' }[] {
  const results: { submissionIds: string[]; reason: 'contact' | 'name' }[] = [];
  for (const reason of ['contact', 'name'] as const) {
    const groups = new Map<string, Set<string>>();
    for (const party of parties) {
      const contact = party.response.contact;
      const key = reason === 'name' ? normalizeContactName(contact.fullName) : parsePhoneNumberFromString(contact.whatsapp)?.number;
      if (!key) continue;
      const ids = groups.get(key) ?? new Set<string>();
      ids.add(party.id); groups.set(key, ids);
    }
    for (const ids of groups.values()) if (ids.size > 1) results.push({ submissionIds: [...ids], reason });
  }
  return results;
}
