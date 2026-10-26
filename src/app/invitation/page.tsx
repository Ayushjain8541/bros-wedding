import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { requireGuest } from '@/features/access/service';
import { readInvitation } from '@/features/wedding/repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InvitationPage() {
  const db = getDb();
  const cookie = (await cookies()).get('wedding_guest')?.value;
  const actor = await requireGuest(cookie, db).catch(error => {
    if (error instanceof DomainError && error.status === 401) redirect('/');
    throw error;
  });
  // Authenticate on every protected request, then filter in SQL before rendering.
  const { content, events } = await readInvitation(actor.groupId, db);
  return <main>
    <h1>{content.couple.displayName.en}</h1>
    <p>{content.wedding.venueName.en}</p>
    <ul>{events.map(event => <li key={event.id} data-event-id={event.id}>{event.title.en}</li>)}</ul>
  </main>;
}
