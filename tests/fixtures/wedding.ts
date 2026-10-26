import type { AcceptInput, DeclineInput, GuestActor } from "@/features/wedding/types";
import { getInitialContent, getInitialEvents, getInitialSettings } from "@/features/wedding/defaults";
export const EVENTS = getInitialEvents();
export const CONTENT = getInitialContent();
export const SETTINGS = getInitialSettings();
export const GUEST_1: GuestActor = { kind: "guest", groupId: "group-1", sessionId: "synthetic-session-1" };
export const GUEST_2: GuestActor = { kind: "guest", groupId: "group-2", sessionId: "synthetic-session-2" };
export function acceptedInput(overrides: Partial<AcceptInput> = {}): AcceptInput {
  return { decision: "accept", contact: { fullName: "Asha Jain", whatsapp: "+12025550123" }, guestNames: ["Asha Jain", "Ravi Jain", "Neha Jain"], eventIds: ["haldi"], travel: { arrivalDate: "2027-02-12", arrivalWindow: "noon-5pm", departureDate: "2027-02-14", departureWindow: "before-noon" }, ...overrides };
}
export function declinedInput(): DeclineInput {
  return { decision: "decline", contact: { fullName: "Asha Jain", whatsapp: "+12025550123" } };
}
