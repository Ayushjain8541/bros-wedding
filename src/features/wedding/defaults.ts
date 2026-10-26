import "server-only";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import type { ContentSnapshot, EventId, SiteSettings, WeddingEvent, WeddingSeed } from "./types";

const eventIds = ["mehendi", "brides-mayara", "haldi", "grooms-mayara", "reception", "baraat", "phere-sajjan-goth", "closing-dinner"] as const;
const text = z.string().trim().min(1).max(10_000);
const bilingual = z.strictObject({ en: text, hi: text });
const httpUrl = z.url().refine(value => ["https:", "http:"].includes(new URL(value).protocol));
const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const eventSchema = z.strictObject({
  id: z.enum(eventIds), startAt: timestamp, endAt: timestamp.nullable(),
  title: bilingual, description: z.strictObject({ en: z.string().max(10_000), hi: z.string().max(10_000) }), eligibleGroups: z.array(z.enum(["group-1", "group-2"])).min(1).max(2),
  venueSublocation: bilingual.nullable(), dressCode: bilingual.nullable(), mapUrl: httpUrl, cancelled: z.boolean(),
}).refine(event => event.endAt === null || Date.parse(event.endAt) > Date.parse(event.startAt));
const contentSchema = z.strictObject({
  revision: z.number().int().positive(),
  couple: z.strictObject({ displayName: bilingual, brideName: bilingual, groomName: bilingual }),
  wedding: z.strictObject({ startDate: date, endDate: date, venueName: bilingual, address: bilingual, mapUrl: httpUrl })
    .refine(wedding => wedding.endDate >= wedding.startDate),
  story: bilingual, families: bilingual, welcome: bilingual,
  ceremonyCopyApproved: z.boolean(), hindiApproved: z.boolean(),
  photos: z.array(z.strictObject({
    id: text, storagePath: z.string().min(1).max(2048).refine(value => !value.startsWith("/") && !value.includes("..") && !value.includes(":")),
    alt: bilingual, position: z.number().int().nonnegative(), provenance: text,
  })),
  labels: z.strictObject({ en: z.record(z.string(), text), hi: z.record(z.string(), text) }),
});
const settingsSchema = z.strictObject({
  newRsvpClosesAt: timestamp, helpPhone: z.string().regex(/^\+[1-9][\d ]{6,20}$/),
  helpTelUrl: z.string().regex(/^tel:\+[1-9]\d{6,14}$/),
  helpWhatsAppUrl: z.url().refine(value => /^https:\/\/wa\.me\/[1-9]\d{6,14}$/.test(value)),
  maxPartySize: z.number().int().min(1).max(200),
}).refine(settings => settings.helpTelUrl === `tel:${settings.helpPhone.replaceAll(" ", "")}` && settings.helpWhatsAppUrl === `https://wa.me/${settings.helpPhone.replaceAll(" ", "").slice(1)}`);
const seedSchema = z.strictObject({ events: z.array(eventSchema).length(8), content: contentSchema, settings: settingsSchema })
  .refine(seed => eventIds.every((id, index) => seed.events[index].id === id))
  .refine(seed => seed.events.every(event => {
    const wanted = event.id === "mehendi" || event.id === "closing-dinner" ? ["group-1"] : ["group-1", "group-2"];
    return event.eligibleGroups.length === wanted.length && wanted.every(group => event.eligibleGroups.includes(group as "group-1" | "group-2"));
  }));

/** Operator-only input: callers must opt in; missing or invalid private input never silently becomes synthetic content. */
export function readWeddingSeed(path: string): WeddingSeed {
  try {
    return seedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new DomainError("INVALID_WEDDING_SEED", 422);
  }
}

const pair = (en: string, hi: string) => ({ en, hi });
const syntheticMap = "https://example.com/sample-venue";
const windows: [string, string | null][] = [
  ["2030-02-12T10:30:00Z", null], ["2030-02-13T05:30:00Z", "2030-02-13T07:00:00Z"],
  ["2030-02-13T07:30:00Z", "2030-02-13T10:30:00Z"], ["2030-02-13T11:00:00Z", "2030-02-13T12:30:00Z"],
  ["2030-02-13T14:00:00Z", null], ["2030-02-14T04:30:00Z", "2030-02-14T06:30:00Z"],
  ["2030-02-14T07:30:00Z", "2030-02-14T09:30:00Z"], ["2030-02-14T13:30:00Z", null],
];

/** Synthetic fixtures only. Protected production pages load the authorized repository. */
export function getInitialEvents(): WeddingEvent[] {
  return eventIds.map((id: EventId, index) => ({
    id, startAt: windows[index][0], endAt: windows[index][1],
    title: pair(`Sample celebration ${index + 1}`, `उदाहरण समारोह ${index + 1}`),
    description: pair("Draft sample description awaiting approval.", "स्वीकृति के लिए उदाहरण विवरण का मसौदा।"),
    eligibleGroups: id === "mehendi" || id === "closing-dinner" ? ["group-1"] : ["group-1", "group-2"],
    venueSublocation: null, dressCode: null, mapUrl: syntheticMap, cancelled: false,
  }));
}

export function getInitialContent(): ContentSnapshot {
  return {
    revision: 1,
    couple: { displayName: pair("Sample Bride & Sample Groom", "उदाहरण वधू और उदाहरण वर"), brideName: pair("Sample Bride", "उदाहरण वधू"), groomName: pair("Sample Groom", "उदाहरण वर") },
    wedding: { startDate: "2030-02-12", endDate: "2030-02-14", venueName: pair("Sample venue", "उदाहरण स्थल"), address: pair("Sample city, India", "उदाहरण शहर, भारत"), mapUrl: syntheticMap },
    story: pair("A sample story awaiting the family's approved private content.", "परिवार की स्वीकृति की प्रतीक्षा में कहानी का उदाहरण।"),
    families: pair("Sample families — private names pending.", "उदाहरण परिवार — निजी नाम अभी उपलब्ध नहीं हैं।"),
    welcome: pair("Welcome to this sample invitation.", "इस उदाहरण निमंत्रण में आपका स्वागत है।"),
    ceremonyCopyApproved: false, hindiApproved: false, photos: [], labels: { en: {}, hi: {} },
  };
}

export function getInitialSettings(): SiteSettings {
  return { newRsvpClosesAt: "2026-11-30T18:30:00Z", helpPhone: "+12025550123", helpTelUrl: "tel:+12025550123", helpWhatsAppUrl: "https://wa.me/12025550123", maxPartySize: 200 };
}
