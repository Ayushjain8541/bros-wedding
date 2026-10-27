import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
import type { EventId, ValidatedRsvp } from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import { travelSchema } from "./travel";

const eventIds = ["mehendi", "brides-mayara", "haldi", "grooms-mayara", "reception", "baraat", "phere-sajjan-goth", "closing-dinner"] as const;
const objectError = { error: (issue: { input?: unknown }) => issue.input === undefined ? "required" : "invalid_type" };
const component = /^[\p{L}\p{M}]+(?:['’.-][\p{L}\p{M}]+)*\.?$/u;
const fullName = z.string({ error: (issue) => issue.input === undefined ? "invalid_name" : "invalid_type" }).trim().max(200, "too_long").refine((name) => {
  const parts = name.split(/\s+/u);
  return parts.length >= 2 && parts.every((part) => component.test(part));
}, "invalid_name");

const phone = z.string({ error: "invalid_phone" }).trim().transform((value, context) => {
  const parsed = value.startsWith("+") ? parsePhoneNumberFromString(value, { extract: false }) : undefined;
  if (!parsed?.isValid() || parsed.ext) {
    context.addIssue({ code: "custom", message: "invalid_phone" });
    return z.NEVER;
  }
  return parsed.number;
});
const contact = z.strictObject({ fullName, whatsapp: phone }, objectError);
const freeText = z.string({ error: "invalid_type" }).max(2000, "too_long");
const songPart = z.string({ error: "invalid_song" }).trim().min(1, "invalid_song").max(200, "too_long");
const url = z.string({ error: "invalid_url" }).max(2048, "too_long").refine((value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}, "invalid_url");
const song = z.strictObject({ name: songPart, artist: songPart, url: url.optional() }, objectError);

/** Validate only against the caller's server-derived eligibility and configured party limit. */
export function validateRsvp(input: unknown, eligibleIds: readonly EventId[], maxPartySize: number): ValidatedRsvp {
  const limit = Number.isInteger(maxPartySize) && maxPartySize > 0 ? Math.min(maxPartySize, 200) : 0;
  const selectedEvents = z.array(z.enum(eventIds, { error: "invalid_events" }), { error: "invalid_events" })
    .min(1, "invalid_events").superRefine((selected, context) => {
      const seen = new Set<EventId>();
      selected.forEach((id, index) => {
        if (!eligibleIds.includes(id)) context.addIssue({ code: "custom", path: [index], message: "unauthorized_event" });
        if (seen.has(id)) context.addIssue({ code: "custom", path: [index], message: "duplicate_event" });
        seen.add(id);
      });
    });
  const schema = z.discriminatedUnion("decision", [
    z.strictObject({
      decision: z.literal("accept"), contact,
      guestNames: z.array(fullName, objectError).min(1, "invalid_party_size").max(limit, "invalid_party_size"),
      eventIds: selectedEvents, travel: travelSchema, song: song.optional(), questions: freeText.optional(),
    }, objectError),
    z.strictObject({ decision: z.literal("decline"), contact, note: freeText.optional() }, objectError),
  ], { error: (issue) => issue.code === "invalid_union" ? "invalid_decision" : "invalid_type" });
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string[]> = Object.create(null);
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields[[...issue.path, key].join(".")] = ["unknown_field"];
    } else {
      const path = issue.path.join(".") || "_form";
      (fields[path] ??= []).push(issue.message);
    }
  }
  throw new DomainError("VALIDATION_FAILED", 422, fields);
}

/** The configured instant is exclusive; secure edits are governed by their own service. */
export function isNewRsvpOpen(now: Date, closesAt: string): boolean {
  return now.getTime() < Date.parse(closesAt);
}
