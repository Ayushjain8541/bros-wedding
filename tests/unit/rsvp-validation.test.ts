import { describe, expect, it } from "vitest";
import { validateRsvp, isNewRsvpOpen } from "@/features/rsvp/validation";
import { DomainError } from "@/lib/errors";
import { acceptedInput, declinedInput, SETTINGS } from "../fixtures/wedding";
import en from "@/i18n/messages/en.json";
import hi from "@/i18n/messages/hi.json";

function rejects(input: unknown, field: string, code: string, maxPartySize = 200) {
  expect(() => validateRsvp(input, ["haldi"], maxPartySize)).toThrowError(DomainError);
  try { validateRsvp(input, ["haldi"], maxPartySize); }
  catch (error) {
    expect(error).toMatchObject({ code: "VALIDATION_FAILED", status: 422, fieldErrors: { [field]: expect.arrayContaining([code]) } });
    expect(en.Errors).toHaveProperty(code);
    expect(hi.Errors).toHaveProperty(code);
  }
}

describe("validateRsvp", () => {
  it("accepts_unicode_full_names", () => {
    const result = validateRsvp(acceptedInput({ contact: { fullName: "आयुष जैन", whatsapp: "+12025550123" }, guestNames: ["आयुष जैन", "Anne-Marie O’Neil"] }), ["haldi"], 200);
    expect(result.decision).toBe("accept");
    if (result.decision === "accept") expect(result.guestNames).toEqual(["आयुष जैन", "Anne-Marie O’Neil"]);
  });

  it("requires_exact_guest_count", () => {
    // No separate count is trusted: each array entry must contain a complete name.
    rejects({ ...acceptedInput(), guestCount: 4 }, "guestCount", "unknown_field");
    rejects(acceptedInput({ guestNames: ["Asha Jain", ""] }), "guestNames.1", "invalid_name");
    const result = validateRsvp(acceptedInput({ guestNames: ["Asha Jain"] }), ["haldi"], 200);
    if (result.decision === "accept") expect(result.guestNames).toHaveLength(1);
    else throw new Error("Expected accepted response");
  });

  it("enforces_party_size_from_one_to_200_and_the_configured_limit", () => {
    rejects(acceptedInput({ guestNames: [] }), "guestNames", "invalid_party_size");
    rejects(acceptedInput({ guestNames: Array(201).fill("Asha Jain") }), "guestNames", "invalid_party_size");
    rejects(acceptedInput(), "guestNames", "invalid_party_size", 2);
    expect(validateRsvp(acceptedInput({ guestNames: Array(200).fill("Asha Jain") }), ["haldi"], 200).decision).toBe("accept");
    rejects(acceptedInput({ guestNames: Array(201).fill("Asha Jain") }), "guestNames", "invalid_party_size", 500);
  });

  it.each(["Asha", "   ", "123 Jain", "👩 Jain"])("requires_a_complete_contact_name: %s", (fullName) => {
    rejects(acceptedInput({ contact: { fullName, whatsapp: "+12025550123" } }), "contact.fullName", "invalid_name");
    rejects({ ...declinedInput(), contact: { fullName, whatsapp: "+12025550123" } }, "contact.fullName", "invalid_name");
  });

  it("normalizes_international_phone", () => {
    const input = acceptedInput({ contact: { fullName: "Asha Jain", whatsapp: "+1 (202) 555-0123" } });
    expect(validateRsvp(input, ["haldi"], 200).contact.whatsapp).toBe("+12025550123");
    expect(input.contact.whatsapp).toBe("+1 (202) 555-0123");
    expect(validateRsvp({ ...declinedInput(), contact: input.contact }, ["haldi"], 200).contact.whatsapp).toBe("+12025550123");
  });

  it.each(["2025550123", "+123", "call +12025550123", "", "+1 202 555 0123 ext 4"])("requires_a_valid_international_contact: %s", (whatsapp) => {
    rejects(acceptedInput({ contact: { fullName: "Asha Jain", whatsapp } }), "contact.whatsapp", "invalid_phone");
  });

  it("rejects_unauthorized_event", () => {
    rejects(acceptedInput({ eventIds: ["mehendi"] }), "eventIds.0", "unauthorized_event");
    rejects(acceptedInput({ eventIds: ["invented"] as never }), "eventIds.0", "invalid_events");
    rejects(acceptedInput({ eventIds: [] }), "eventIds", "invalid_events");
  });

  it("rejects_duplicate_events", () => {
    rejects(acceptedInput({ eventIds: ["haldi", "haldi"] }), "eventIds.1", "duplicate_event");
  });

  it.each(["guestNames", "eventIds", "travel", "song", "questions"])("rejects_stale_decline_fields: %s", (field) => {
    rejects({ ...declinedInput(), [field]: acceptedInput()[field as keyof ReturnType<typeof acceptedInput>] ?? "old value" }, field, "unknown_field");
  });

  it("rejects_unknown_fields_at_every_object_boundary", () => {
    rejects({ ...acceptedInput(), extra: true }, "extra", "unknown_field");
    rejects(acceptedInput({ contact: { ...acceptedInput().contact, email: "x" } as never }), "contact.email", "unknown_field");
    rejects(acceptedInput({ travel: { ...acceptedInput().travel, hotel: "x" } as never }), "travel.hotel", "unknown_field");
    rejects(acceptedInput({ song: { name: "Song", artist: "Artist", extra: true } as never }), "song.extra", "unknown_field");
  });

  it("reports_prototype_named_unknown_fields_as_own_fields", () => {
    const input = JSON.parse(JSON.stringify(acceptedInput()).replace('{', '{"__proto__":true,'));
    try { validateRsvp(input, ["haldi"], 200); throw new Error("Expected validation failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(Object.hasOwn((error as DomainError).fieldErrors!, "__proto__")).toBe(true);
      expect((error as DomainError).fieldErrors!["__proto__"]).toEqual(["unknown_field"]);
    }
  });

  it("enforces_name_and_free_text_length_boundaries", () => {
    const name200 = `${"A".repeat(198)} B`;
    expect(validateRsvp(acceptedInput({ contact: { fullName: name200, whatsapp: "+12025550123" }, guestNames: [name200], questions: "x".repeat(2000) }), ["haldi"], 200).decision).toBe("accept");
    rejects(acceptedInput({ contact: { fullName: `${name200}C`, whatsapp: "+12025550123" } }), "contact.fullName", "too_long");
    rejects(acceptedInput({ guestNames: [`${name200}C`] }), "guestNames.0", "too_long");
    rejects(acceptedInput({ questions: "x".repeat(2001) }), "questions", "too_long");
    expect(validateRsvp({ ...declinedInput(), note: "x".repeat(2000) }, [], 200).decision).toBe("decline");
    rejects({ ...declinedInput(), note: "x".repeat(2001) }, "note", "too_long");
  });

  it("requires_both_song_name_and_artist_when_present", () => {
    rejects(acceptedInput({ song: { name: "Song", artist: "" } }), "song.artist", "invalid_song");
    rejects(acceptedInput({ song: { name: "", artist: "Artist" } }), "song.name", "invalid_song");
    rejects(acceptedInput({ song: { name: "Song" } as never }), "song.artist", "invalid_song");
    rejects(acceptedInput({ song: { name: "x".repeat(201), artist: "Artist" } }), "song.name", "too_long");
    rejects(acceptedInput({ song: { name: "Song", artist: "x".repeat(201) } }), "song.artist", "too_long");
    expect(validateRsvp(acceptedInput({ song: { name: "x".repeat(200), artist: "x".repeat(200) } }), ["haldi"], 200).decision).toBe("accept");
  });

  it.each(["javascript:alert(1)", "data:text/plain,x", "ftp://example.com", "//example.com", "not a link"])("allows_only_HTTP_or_HTTPS_song_URLs: %s", (url) => {
    rejects(acceptedInput({ song: { name: "Song", artist: "Artist", url } }), "song.url", "invalid_url");
  });

  it("accepts_HTTP_links_and_bounds_URL_length", () => {
    for (const url of ["http://example.com/song", "https://example.com/song", `https://example.com/${"x".repeat(2028)}`]) {
      expect(validateRsvp(acceptedInput({ song: { name: "Song", artist: "Artist", url } }), ["haldi"], 200).decision).toBe("accept");
    }
    rejects(acceptedInput({ song: { name: "Song", artist: "Artist", url: `https://example.com/${"x".repeat(2030)}` } }), "song.url", "too_long");
  });

  it("treats_questions_as_plain_text_without_modifying_them", () => {
    const result = validateRsvp(acceptedInput({ questions: "<script>alert('text')</script>" }), ["haldi"], 200);
    if (result.decision === "accept") expect(result.questions).toBe("<script>alert('text')</script>");
    else throw new Error("Expected accepted response");
  });

  it("exposes_localized_field_errors_for_malformed_shapes", () => {
    rejects(null, "_form", "invalid_type");
    rejects({ decision: "maybe" }, "decision", "invalid_decision");
    rejects({ decision: "accept" }, "contact", "required");
    rejects(acceptedInput({ guestNames: [12] as never }), "guestNames.0", "invalid_type");
  });

  it("validates_travel_through_the_response_boundary", () => {
    rejects(acceptedInput({ travel: { ...acceptedInput().travel, arrivalDate: "2027-02-29" } }), "travel.arrivalDate", "invalid_date");
    rejects(acceptedInput({ travel: { ...acceptedInput().travel, arrivalWindow: "midnight" } as never }), "travel.arrivalWindow", "invalid_window");
  });
});

describe("isNewRsvpOpen", () => {
  it("closes_after_full_final_minute", () => {
    expect(isNewRsvpOpen(new Date("2026-11-30T18:29:59.999Z"), SETTINGS.newRsvpClosesAt)).toBe(true);
    expect(isNewRsvpOpen(new Date("2026-11-30T18:30:00Z"), SETTINGS.newRsvpClosesAt)).toBe(false);
    expect(isNewRsvpOpen(new Date("2026-12-01T00:00:00Z"), SETTINGS.newRsvpClosesAt)).toBe(false);
  });
  it("fails_closed_for_invalid_timestamps", () => {
    expect(isNewRsvpOpen(new Date("invalid"), SETTINGS.newRsvpClosesAt)).toBe(false);
    expect(isNewRsvpOpen(new Date(), "invalid")).toBe(false);
  });
});
