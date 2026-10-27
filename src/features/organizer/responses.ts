import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/db/server";
import type {
  EventId,
  GroupId,
  OrganizerActor,
  PartySnapshot,
  TimeWindow,
} from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import { assertOrganizer } from "./auth";
import { findDuplicateGroups } from "@/features/rsvp/duplicates";
export type AdminFilters = {
  query?: string;
  decision?: "accept" | "decline";
  groupId?: GroupId;
  eventId?: EventId;
  arrivalDate?: string;
  departureDate?: string;
  duplicateOnly?: boolean;
  cursor?: string;
};
const date = z.iso.date();
const filtersSchema = z
  .object({
    query: z.string().max(200).optional(),
    decision: z.enum(["accept", "decline"]).optional(),
    groupId: z.enum(["group-1", "group-2"]).optional(),
    eventId: z
      .enum([
        "mehendi",
        "brides-mayara",
        "haldi",
        "grooms-mayara",
        "reception",
        "baraat",
        "phere-sajjan-goth",
        "closing-dinner",
      ])
      .optional(),
    arrivalDate: date.optional(),
    departureDate: date.optional(),
    duplicateOnly: z.boolean().optional(),
    cursor: z.string().uuid().optional(),
  })
  .strict();
export function parseAdminFilters(params: URLSearchParams): AdminFilters {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of params) {
    if (k in raw) throw new DomainError("INVALID_REQUEST", 400);
    raw[k] =
      k === "duplicateOnly"
        ? v === "true"
          ? true
          : v === "false"
            ? false
            : v
        : v;
  }
  const result = filtersSchema.safeParse(raw);
  if (!result.success) throw new DomainError("INVALID_REQUEST", 400);
  return result.data;
}
async function snapshots(
  db: Database,
  ids?: string[],
): Promise<PartySnapshot[]> {
  const rows =
    await db`select *,to_char(arrival_date,'YYYY-MM-DD') as arrival_day,to_char(departure_date,'YYYY-MM-DD') as departure_day from wedding.rsvp_submissions ${ids ? db`where id in ${db(ids)}` : db``} order by id`;
  if (!rows.length) return [];
  const keys = rows.map((r) => r.id);
  const names =
    await db`select submission_id,full_name from wedding.rsvp_guests where submission_id in ${db(keys)} order by position`;
  const events =
    await db`select s.submission_id,s.event_id from wedding.rsvp_event_selections s join wedding.events e on e.id=s.event_id where s.submission_id in ${db(keys)} order by e.start_at,e.id`;
  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    version: row.version,
    source: row.source,
    response:
      row.decision === "decline"
        ? {
            decision: "decline",
            contact: {
              fullName: row.contact_full_name,
              whatsapp: row.contact_phone,
            },
            ...(row.note === null ? {} : { note: row.note }),
          }
        : {
            decision: "accept",
            contact: {
              fullName: row.contact_full_name,
              whatsapp: row.contact_phone,
            },
            guestNames: names
              .filter((n) => n.submission_id === row.id)
              .map((n) => n.full_name),
            eventIds: events
              .filter((e) => e.submission_id === row.id)
              .map((e) => e.event_id as EventId),
            travel: {
              arrivalDate: row.arrival_day,
              arrivalWindow: row.arrival_window as TimeWindow,
              departureDate: row.departure_day,
              departureWindow: row.departure_window as TimeWindow,
            },
            ...(row.song_name && row.song_artist
              ? {
                  song: {
                    name: row.song_name,
                    artist: row.song_artist,
                    ...(row.song_url ? { url: row.song_url } : {}),
                  },
                }
              : {}),
            ...(row.questions ? { questions: row.questions } : {}),
          },
  }));
}
export async function listResponses(
  actor: OrganizerActor,
  filters: AdminFilters,
  db: Database,
): Promise<{ items: PartySnapshot[]; nextCursor: string | null }> {
  const parsed = filtersSchema.safeParse(filters);
  if (!parsed.success) throw new DomainError("INVALID_REQUEST", 400);
  return db.begin("isolation level repeatable read read only", async (tx) => {
    const sql = tx as unknown as Database;
    await assertOrganizer(actor, sql);
    // strpos is deliberately literal: %, _, apostrophes and SQL punctuation are data.
    const rows = await tx`select r.id from wedding.rsvp_submissions r where
      ${filters.query ? tx`(strpos(lower(r.contact_full_name),lower(${filters.query}))>0 or strpos(r.contact_phone,${filters.query})>0 or exists(select 1 from wedding.rsvp_guests g where g.submission_id=r.id and strpos(lower(g.full_name),lower(${filters.query}))>0))` : tx`true`}
      and ${filters.decision ? tx`r.decision=${filters.decision}` : tx`true`}
      and ${filters.groupId ? tx`r.group_id=${filters.groupId}` : tx`true`}
      and ${filters.eventId ? tx`exists(select 1 from wedding.rsvp_event_selections e where e.submission_id=r.id and e.event_id=${filters.eventId})` : tx`true`}
      and ${filters.arrivalDate ? tx`r.arrival_date=${filters.arrivalDate}` : tx`true`}
      and ${filters.departureDate ? tx`r.departure_date=${filters.departureDate}` : tx`true`}
      and ${filters.cursor ? tx`r.id>${filters.cursor}` : tx`true`} order by r.id ${filters.duplicateOnly ? tx`` : tx`limit 51`}`;
    let ids = rows.map((r) => r.id as string);
    if (filters.duplicateOnly) {
      const all = await snapshots(sql);
      const duplicates = new Set(
        findDuplicateGroups(all).flatMap((g) => g.submissionIds),
      );
      ids = ids.filter((id) => duplicates.has(id)).slice(0, 51);
    }
    const more = ids.length > 50;
    ids = ids.slice(0, 50);
    return {
      items: ids.length ? await snapshots(sql, ids) : [],
      nextCursor: more ? ids.at(-1)! : null,
    };
  }) as Promise<{ items: PartySnapshot[]; nextCursor: string | null }>;
}
export async function readResponse(
  actor: OrganizerActor,
  id: string,
  db: Database,
): Promise<PartySnapshot> {
  if (!z.uuid().safeParse(id).success)
    throw new DomainError("INVALID_REQUEST", 400);
  return db.begin("isolation level repeatable read read only", async (tx) => {
    const sql = tx as unknown as Database;
    await assertOrganizer(actor, sql);
    const [party] = await snapshots(sql, [id]);
    if (!party) throw new DomainError("NOT_FOUND", 404);
    return party;
  }) as Promise<PartySnapshot>;
}

/** Coherent full snapshot for aggregate/export reads; never reuse the 50-row listing. */
export async function readAllResponses(
  actor: OrganizerActor,
  db: Database,
): Promise<PartySnapshot[]> {
  return db.begin("isolation level repeatable read read only", async (tx) => {
    const sql = tx as unknown as Database;
    await assertOrganizer(actor, sql);
    return snapshots(sql);
  }) as Promise<PartySnapshot[]>;
}
