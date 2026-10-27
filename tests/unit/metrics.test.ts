import { describe, expect, test } from "vitest";
import { computeMetrics } from "@/features/organizer/metrics";
import { findDuplicateGroups } from "@/features/rsvp/duplicates";
import { acceptedInput, declinedInput, EVENTS } from "../fixtures/wedding";
import type { PartySnapshot } from "@/features/wedding/types";
const party = (response = acceptedInput()): PartySnapshot => ({
  id: "p1",
  groupId: "group-1",
  version: 1,
  source: "website",
  response,
});
describe("individual attendance and calendar stays", () => {
  test("aggregates all dimensions and retains empty event/group counts", () => {
    const one = party(
      acceptedInput({
        questions: "Accessible transfer?",
        song: {
          name: "गीत",
          artist: "Artist",
          url: "https://example.test/song",
        },
      }),
    );
    const two: PartySnapshot = {
      ...party(),
      id: "p2",
      groupId: "group-2",
      response: declinedInput(),
    };
    const m = computeMetrics([one, two]);
    expect(m).toMatchObject({
      acceptingSubmissions: 1,
      decliningSubmissions: 1,
      attendingGuests: 3,
      guestNights: 6,
      nightlyGuests: { "2027-02-12": 3, "2027-02-13": 3 },
      arrivals: { "2027-02-12": { "noon-5pm": 3 } },
      departures: { "2027-02-14": { "before-noon": 3 } },
      groups: {
        "group-1": {
          acceptingSubmissions: 1,
          decliningSubmissions: 0,
          attendingGuests: 3,
        },
        "group-2": {
          acceptingSubmissions: 0,
          decliningSubmissions: 1,
          attendingGuests: 0,
        },
      },
      questions: [{ submissionId: "p1", text: "Accessible transfer?" }],
      songs: [
        {
          submissionId: "p1",
          song:
            one.response.decision === "accept" ? one.response.song : undefined,
        },
      ],
    });
    expect(m.eventGuests).toEqual(
      Object.fromEntries(EVENTS.map((e) => [e.id, e.id === "haldi" ? 3 : 0])),
    );
    expect(m.duplicates).toEqual(findDuplicateGroups([one, two]));
  });
  test("recomputes three to one and same-day has zero nights", () => {
    const one = party();
    expect(computeMetrics([one]).attendingGuests).toBe(3);
    one.response = acceptedInput({
      guestNames: ["Asha Jain"],
      travel: { ...acceptedInput().travel, departureDate: "2027-02-12" },
    });
    expect(computeMetrics([one])).toMatchObject({
      attendingGuests: 1,
      guestNights: 0,
      nightlyGuests: {},
      eventGuests: { haldi: 1 },
    });
  });
  test("crosses December/January and leap days using calendar dates", () => {
    const result = (arrivalDate: string, departureDate: string) =>
      computeMetrics([
        party(
          acceptedInput({
            travel: { ...acceptedInput().travel, arrivalDate, departureDate },
          }),
        ),
      ]);
    expect(result("2026-12-31", "2027-01-02").nightlyGuests).toEqual({
      "2026-12-31": 3,
      "2027-01-01": 3,
    });
    expect(result("2028-02-28", "2028-03-01").guestNights).toBe(6);
    expect(result("0099-12-31", "0100-01-01").nightlyGuests).toEqual({
      "0099-12-31": 3,
    });
    expect(result("2027-01-01", "2028-01-02").guestNights).toBe(1098);
  });
  test.each([
    ["2027-02-30", "2027-03-01"],
    ["2027-02-14", "2027-02-12"],
    ["2027-01-01", "9999-12-31"],
    ["garbage", "2027-02-12"],
  ])("rejects unsafe legacy dates %s / %s", (arrivalDate, departureDate) => {
    expect(() =>
      computeMetrics([
        party(
          acceptedInput({
            travel: { ...acceptedInput().travel, arrivalDate, departureDate },
          }),
        ),
      ]),
    ).toThrow(/stay dates/i);
  });
  test("empty data yields zeros and does not mutate or merge duplicate records", () => {
    expect(computeMetrics([])).toMatchObject({
      attendingGuests: 0,
      guestNights: 0,
      groups: {
        "group-1": { attendingGuests: 0 },
        "group-2": { attendingGuests: 0 },
      },
    });
    const a = party(),
      b = { ...party(), id: "p2" };
    expect(computeMetrics([a, b]).attendingGuests).toBe(6);
    expect(computeMetrics([a, b]).duplicates).toEqual(
      findDuplicateGroups([a, b]),
    );
  });
});
