import 'server-only';
import { redirect } from 'next/navigation';
import type { Database } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { requireOrganizer } from './auth';
/** Pages and layouts render concurrently; each page handles its own expected denial. */
export async function requireOrganizerPage(db: Database) {
  try { return await requireOrganizer(db); }
  catch (error) {
    if (error instanceof DomainError && [401,403].includes(error.status)) redirect('/admin/login');
    throw error;
  }
}
