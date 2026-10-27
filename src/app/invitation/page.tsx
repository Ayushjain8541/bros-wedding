import { getLocale } from 'next-intl/server';
import { Invitation } from '@/features/invitation/Invitation';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { requireGuest } from '@/features/access/service';
import { readInvitation } from '@/features/wedding/repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ opened?: string }> }) {
  const db = getDb();
  const cookie = (await cookies()).get('wedding_guest')?.value;
  const actor = await requireGuest(cookie, db).catch(error => {
    if (error instanceof DomainError && error.status === 401) redirect('/');
    throw error;
  });
  // Authenticate on every protected request, then filter in SQL before rendering.
  const { content, events, settings } = await readInvitation(actor.groupId, db);
  const locale = (await getLocale()) === 'hi' ? 'hi' : 'en';
  return <Invitation content={content} events={events} settings={settings} locale={locale} initiallyOpened={(await searchParams).opened === '1'}/>;
}
