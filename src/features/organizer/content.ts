import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/db/server";
import type {
  ContentSnapshot,
  OrganizerActor,
  SiteSettings,
  WeddingEvent,
} from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import { readInvitation } from "@/features/wedding/repository";
import { assertOrganizer } from "./auth";
import en from "@/i18n/messages/en.json";
export type ContentPatch = {
  expectedRevision: number;
  content: ContentSnapshot;
  events: WeddingEvent[];
  settings: SiteSettings;
  confirmEnglishStoryChange?: boolean;
  confirmDeadlineChange?: boolean;
};
const text = z
  .string()
  .trim()
  .min(1)
  .max(10000)
  .refine(
    (v) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),
    "Use plain text",
  );
const optionalText = text.or(z.literal(""));
export const photoAltSchema = z.strictObject({
  en: text.max(500),
  hi: text.max(500),
});
export const provenanceSchema = text.max(2000);
const pair = z.strictObject({ en: text, hi: text });
const optionalPair = z.strictObject({ en: optionalText, hi: optionalText });
const url = z
  .url()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        ["https:", "http:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !/[<>\u0000-\u0020]/.test(v)
      );
    } catch {
      return false;
    }
  });
const stamp = z.iso.datetime({ offset: true });
const eventSchema = z.strictObject({
  id: z.string(),
  startAt: stamp,
  endAt: stamp.nullable(),
  title: pair,
  description: optionalPair,
  eligibleGroups: z.array(z.enum(["group-1", "group-2"])),
  venueSublocation: pair.nullable(),
  dressCode: pair.nullable(),
  mapUrl: url,
  cancelled: z.boolean(),
});
const labelKey = z.string().refine((k) => Object.hasOwn(en.Invitation, k));
// Invitation labels are plain strings. ICU control syntax is not editable copy.
const labelValue = text.max(1000).refine((v) => !/[{}]/.test(v));
const photoSchema = z.strictObject({
  id: z.uuid(),
  storagePath: z.string().max(200),
  alt: photoAltSchema,
  provenance: provenanceSchema,
  position: z.number().int().min(0).max(19),
});
const contentSchema = z.strictObject({
  revision: z.number().int().positive(),
  couple: z.strictObject({
    displayName: pair,
    brideName: pair,
    groomName: pair,
  }),
  wedding: z.strictObject({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    venueName: pair,
    address: pair,
    mapUrl: url,
  }),
  story: pair,
  families: pair,
  welcome: pair,
  ceremonyCopyApproved: z.boolean(),
  hindiApproved: z.boolean(),
  photos: z.array(photoSchema).max(20),
  labels: z.strictObject({
    en: z.record(labelKey, labelValue),
    hi: z.record(labelKey, labelValue),
  }),
});
const patchSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  content: contentSchema,
  events: z.array(eventSchema).length(8),
  settings: z.strictObject({
    newRsvpClosesAt: stamp,
    helpPhone: z.string().regex(/^\+[1-9][\d ]{6,20}$/),
    helpTelUrl: z.string().regex(/^tel:\+[1-9]\d{6,14}$/),
    helpWhatsAppUrl: z.string().regex(/^https:\/\/wa\.me\/[1-9]\d{6,14}$/),
    maxPartySize: z.number().int().min(1).max(200),
  }),
  confirmEnglishStoryChange: z.boolean().optional(),
  confirmDeadlineChange: z.boolean().optional(),
});
const invalid = (field = "_form") =>
  new DomainError("VALIDATION_FAILED", 422, { [field]: ["invalid_content"] });
const day = (s: string) =>
  new Date(Date.parse(s) + 330 * 60000).toISOString().slice(0, 10);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export async function readContent(actor: OrganizerActor, db: Database) {
  await assertOrganizer(actor, db);
  return readInvitation("group-1", db);
}
/** Shared lock order with RSVP: settings, organizer, content. All editorial writes use it. */
export async function lockContent(
  actor: OrganizerActor,
  expectedRevision: number,
  db: Database,
) {
  await db`select singleton from wedding.site_settings where singleton for update`;
  await assertOrganizer(actor, db);
  const [allow] =
    await db`select user_id from wedding.organizer_users where user_id=${actor.userId} for share`;
  if (!allow) throw new DomainError("forbidden", 403);
  const [current] =
    await db`select * from wedding.website_content where singleton for update`;
  if (!current || current.revision !== expectedRevision)
    throw new DomainError("conflict", 409);
  return current;
}
export async function saveContent(
  actor: OrganizerActor,
  input: ContentPatch,
  db: Database,
): Promise<{ revision: number }> {
  await assertOrganizer(actor, db);
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.path.join("."));
  const p = parsed.data;
  const removed: string[] = [];
  const revision = await db.begin(async (transaction) => {
    const tx = transaction as unknown as Database;
    const current = await lockContent(actor, p.expectedRevision, tx);
    if (p.content.revision !== p.expectedRevision)
      throw invalid("content.revision");
    if (
      p.content.wedding.startDate !== current.wedding.startDate ||
      p.content.wedding.endDate !== current.wedding.endDate
    )
      throw invalid("content.wedding");
    if (p.content.story.en !== current.story.en && !p.confirmEnglishStoryChange)
      throw invalid("confirmEnglishStoryChange");
    const [settings] =
      await tx`select * from wedding.site_settings where singleton`;
    if (
      Date.parse(p.settings.newRsvpClosesAt) !==
        settings.new_rsvp_closes_at.getTime() &&
      !p.confirmDeadlineChange
    )
      throw invalid("confirmDeadlineChange");
    const rows =
      await tx`select e.*,array(select group_id from wedding.event_groups where event_id=e.id order by group_id) as groups from wedding.events e order by start_at,id`;
    for (let i = 0; i < rows.length; i++) {
      const old = rows[i],
        e = p.events[i];
      if (
        e.id !== old.id ||
        !same([...e.eligibleGroups].sort(), old.groups) ||
        day(e.startAt) !== day(old.start_at.toISOString()) ||
        (e.endAt &&
          (day(e.endAt) !== day(e.startAt) ||
            Date.parse(e.endAt) <= Date.parse(e.startAt))) ||
        (i > 0 && Date.parse(e.startAt) <= Date.parse(p.events[i - 1].startAt))
      )
        throw invalid(`events.${i}`);
    }
    const photos =
      await tx`select * from wedding.content_photos order by position,id`;
    const ids = new Set(p.content.photos.map((x) => x.id));
    if (
      ids.size !== p.content.photos.length ||
      p.content.photos.some(
        (x, i) =>
          x.position !== i ||
          !photos.some(
            (old) => old.id === x.id && old.storage_path === x.storagePath,
          ),
      )
    )
      throw invalid("content.photos");
    // Reinsert validated references to permit unique position swaps within one atomic transaction.
    await tx`delete from wedding.content_photos`;
    for (const photo of p.content.photos)
      await tx`insert into wedding.content_photos(id,storage_path,alt,position,provenance) values(${photo.id},${photo.storagePath},${tx.json(photo.alt)},${photo.position},${photo.provenance})`;
    removed.push(
      ...photos.filter((x) => !ids.has(x.id)).map((x) => x.storage_path),
    );
    for (const e of p.events)
      await tx`update wedding.events set start_at=${e.startAt},end_at=${e.endAt},title=${tx.json(e.title)},description=${tx.json(e.description)},venue_sublocation=${e.venueSublocation === null ? null : tx.json(e.venueSublocation)},dress_code=${e.dressCode === null ? null : tx.json(e.dressCode)},map_url=${e.mapUrl},cancelled=${e.cancelled} where id=${e.id}`;
    const c = p.content,
      s = p.settings,
      phone = s.helpPhone.replaceAll(" ", "");
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw invalid("settings.helpPhone");
    await tx`update wedding.site_settings set new_rsvp_closes_at=${s.newRsvpClosesAt},help_phone=${phone},help_tel_url=${`tel:${phone}`},help_whatsapp_url=${`https://wa.me/${phone.slice(1)}`},max_party_size=${s.maxPartySize} where singleton`;
    await tx`update wedding.website_content set revision=revision+1,couple=${tx.json(c.couple)},wedding=${tx.json(c.wedding)},story=${tx.json(c.story)},families=${tx.json(c.families)},welcome=${tx.json(c.welcome)},labels=${tx.json(c.labels)},ceremony_copy_approved=${c.ceremonyCopyApproved},hindi_approved=${c.hindiApproved} where singleton`;
    await tx`insert into wedding.audit_log(organizer_user_id,action,details) values(${actor.userId},'content.publish',${tx.json({ previousRevision: current.revision, revision: current.revision + 1, patch: p, previous: { content: current, events: rows, settings, photos } } as never)})`;
    return current.revision + 1;
  });
  if (removed.length) {
    const { removePhotoObjects } = await import("@/lib/storage/server");
    await removePhotoObjects(removed, actor, db);
  }
  return { revision };
}
