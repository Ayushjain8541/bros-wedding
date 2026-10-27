import type {
  EventId,
  GroupId,
  PartySnapshot,
  Song,
  TimeWindow,
} from "@/features/wedding/types";
import { findDuplicateGroups } from "@/features/rsvp/duplicates";
export type DashboardMetrics = {
  acceptingSubmissions: number;
  decliningSubmissions: number;
  attendingGuests: number;
  eventGuests: Record<EventId, number>;
  groups: Record<
    GroupId,
    {
      acceptingSubmissions: number;
      decliningSubmissions: number;
      attendingGuests: number;
    }
  >;
  nightlyGuests: Record<string, number>;
  guestNights: number;
  arrivals: Record<string, Partial<Record<TimeWindow, number>>>;
  departures: Record<string, Partial<Record<TimeWindow, number>>>;
  duplicates: ReturnType<typeof findDuplicateGroups>;
  questions: { submissionId: string; text: string }[];
  songs: { submissionId: string; song: Song }[];
};
const DAY = 86_400_000;
function calendarDay(date: string): number {
  // ISO round-trip rejects rollover dates; parsing ISO avoids Date.UTC's year 0–99 remapping.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000"))
    throw new Error("Invalid stay dates in a response.");
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date)
    throw new Error("Invalid stay dates in a response.");
  return ms;
}
export function computeMetrics(
  parties: readonly PartySnapshot[],
): DashboardMetrics {
  const m: DashboardMetrics = {
    acceptingSubmissions: 0,
    decliningSubmissions: 0,
    attendingGuests: 0,
    eventGuests: {
      mehendi: 0,
      "brides-mayara": 0,
      haldi: 0,
      "grooms-mayara": 0,
      reception: 0,
      baraat: 0,
      "phere-sajjan-goth": 0,
      "closing-dinner": 0,
    },
    groups: {
      "group-1": {
        acceptingSubmissions: 0,
        decliningSubmissions: 0,
        attendingGuests: 0,
      },
      "group-2": {
        acceptingSubmissions: 0,
        decliningSubmissions: 0,
        attendingGuests: 0,
      },
    },
    nightlyGuests: {},
    guestNights: 0,
    arrivals: {},
    departures: {},
    duplicates: findDuplicateGroups(parties),
    questions: [],
    songs: [],
  };
  for (const party of parties) {
    const r = party.response,
      group = m.groups[party.groupId];
    if (r.decision === "decline") {
      m.decliningSubmissions++;
      group.decliningSubmissions++;
      continue;
    }
    const count = r.guestNames.length;
    m.acceptingSubmissions++;
    group.acceptingSubmissions++;
    m.attendingGuests += count;
    group.attendingGuests += count;
    for (const id of new Set(r.eventIds)) m.eventGuests[id] += count;
    const start = calendarDay(r.travel.arrivalDate),
      end = calendarDay(r.travel.departureDate),
      nights = (end - start) / DAY;
    if (nights < 0 || nights > 366)
      throw new Error(
        "Invalid stay dates in a response: stay must be 0–366 nights.",
      );
    for (let i = 0; i < nights; i++) {
      const date = new Date(start + i * DAY).toISOString().slice(0, 10);
      m.nightlyGuests[date] = (m.nightlyGuests[date] ?? 0) + count;
    }
    m.guestNights += count * nights;
    for (const [map, date, window] of [
      [m.arrivals, r.travel.arrivalDate, r.travel.arrivalWindow],
      [m.departures, r.travel.departureDate, r.travel.departureWindow],
    ] as const) {
      const windows = map[date] ?? {};
      windows[window] = (windows[window] ?? 0) + count;
      map[date] = windows;
    }
    if (r.questions?.trim())
      m.questions.push({ submissionId: party.id, text: r.questions });
    if (r.song) m.songs.push({ submissionId: party.id, song: { ...r.song } });
  }
  return m;
}
