import type { GroupId, WeddingEvent } from "./types";

/** Filter on the server before serializing events for a guest. */
export function getEligibleEvents(group: GroupId, events: WeddingEvent[]): WeddingEvent[] {
  return events.filter(event => event.eligibleGroups.includes(group));
}
