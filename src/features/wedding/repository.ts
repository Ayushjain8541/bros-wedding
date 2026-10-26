import 'server-only';
import { DomainError } from '@/lib/errors';
import type { Database } from '@/lib/db/server';
import type { ContentSnapshot, GroupId, SiteSettings, WeddingEvent } from './types';

export async function readSettings(db: Database): Promise<SiteSettings> {
  const [row] = await db`select new_rsvp_closes_at, help_phone, help_tel_url, help_whatsapp_url, max_party_size from wedding.site_settings where singleton`;
  if (!row) throw new DomainError('WEDDING_NOT_CONFIGURED', 503);
  return { newRsvpClosesAt: row.new_rsvp_closes_at.toISOString(), helpPhone: row.help_phone, helpTelUrl: row.help_tel_url, helpWhatsAppUrl: row.help_whatsapp_url, maxPartySize: row.max_party_size };
}

export async function readInvitation(group: GroupId, db: Database): Promise<{content: ContentSnapshot; events: WeddingEvent[]; settings: SiteSettings}> {
  if (group !== 'group-1' && group !== 'group-2') throw new DomainError('INVALID_GROUP', 403);
  // A repeatable snapshot keeps editorial changes coherent across the returned DTO.
  return db.begin('isolation level repeatable read read only', async tx => {
    const [row] = await tx`select * from wedding.website_content where singleton`;
    if (!row) throw new DomainError('WEDDING_NOT_CONFIGURED', 503);
    const photos = await tx`select id, storage_path as "storagePath", alt, position, provenance from wedding.content_photos order by position, id`;
    const content: ContentSnapshot = { revision: row.revision, couple: row.couple, wedding: row.wedding, story: row.story, families: row.families, welcome: row.welcome, ceremonyCopyApproved: row.ceremony_copy_approved, hindiApproved: row.hindi_approved, photos: Array.from(photos, photo => ({ id: photo.id, storagePath: photo.storagePath, alt: photo.alt, position: photo.position, provenance: photo.provenance })), labels: row.labels };
    const rows = await tx`select e.*, array(select eg.group_id from wedding.event_groups eg where eg.event_id=e.id order by eg.group_id) as eligible_groups from wedding.events e join wedding.event_groups allowed on allowed.event_id=e.id and allowed.group_id=${group} order by e.start_at, e.id`;
    const events: WeddingEvent[] = rows.map(event => ({ id: event.id, startAt: event.start_at.toISOString(), endAt: event.end_at?.toISOString() ?? null, title: event.title, description: event.description, eligibleGroups: event.eligible_groups, venueSublocation: event.venue_sublocation, dressCode: event.dress_code, mapUrl: event.map_url, cancelled: event.cancelled }));
    const [settings] = await tx`select * from wedding.site_settings where singleton`;
    if (!settings) throw new DomainError('WEDDING_NOT_CONFIGURED', 503);
    return { content, events, settings: { newRsvpClosesAt: settings.new_rsvp_closes_at.toISOString(), helpPhone: settings.help_phone, helpTelUrl: settings.help_tel_url, helpWhatsAppUrl: settings.help_whatsapp_url, maxPartySize: settings.max_party_size } };
  });
}
