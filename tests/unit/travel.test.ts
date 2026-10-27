import { describe, expect, it } from "vitest";
import { validateTravel } from "@/features/rsvp/travel";
import type { TimeWindow, Travel } from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import { acceptedInput } from "../fixtures/wedding";

function travel(overrides: Partial<Travel> = {}): Travel {
  return { ...acceptedInput().travel, ...overrides };
}
function rejects(input: Travel, field: string, code: string) {
  expect(() => validateTravel(input)).toThrowError(DomainError);
  try { validateTravel(input); }
  catch (error) { expect(error).toMatchObject({ code: "VALIDATION_FAILED", status: 422, fieldErrors: { [field]: [code] } }); }
}

describe("validateTravel", () => {
  it.each(["2027-02-29", "2027-04-31", "2027-13-01", "2027-00-12", "2027-02-00", "2027-2-12", "2027-02-12T00:00:00Z", "0000-01-01"])("rejects_invalid_calendar_dates: %s", (date) => {
    rejects(travel({ arrivalDate: date }), "travel.arrivalDate", "invalid_date");
    rejects(travel({ departureDate: date }), "travel.departureDate", "invalid_date");
  });
  it("accepts_leap_dates_and_dates_outside_the_wedding", () => {
    expect(validateTravel(travel({ arrivalDate: "2028-02-29", departureDate: "2028-03-01" }))).toBeUndefined();
    expect(validateTravel(travel({ arrivalDate: "2026-01-01", departureDate: "2026-01-03" }))).toBeUndefined();
    expect(validateTravel(travel({ arrivalDate: "0099-12-31", departureDate: "0100-01-01" }))).toBeUndefined();
  });
  it("rejects_departure_before_arrival", () => {
    rejects(travel({ departureDate: "2027-02-11" }), "travel.departureDate", "travel_order");
  });
  it("orders_same_day_windows", () => {
    const windows: TimeWindow[] = ["before-noon", "noon-5pm", "5-9pm", "after-9pm"];
    for (const [arrival, arrivalWindow] of windows.entries()) {
      for (const [departure, departureWindow] of windows.entries()) {
        const input = travel({ arrivalDate: "2027-02-12", departureDate: "2027-02-12", arrivalWindow, departureWindow });
        if (departure >= arrival) expect(validateTravel(input)).toBeUndefined();
        else rejects(input, "travel.departureWindow", "travel_order");
      }
    }
  });
  it("orders_windows_only_when_dates_are_equal", () => {
    expect(validateTravel(travel({ arrivalWindow: "after-9pm", departureWindow: "before-noon" }))).toBeUndefined();
  });
  it("bounds_stays_to_366_nights_without_an_absolute_date_range", () => {
    expect(validateTravel(travel({ arrivalDate: "2027-01-01", departureDate: "2028-01-02" }))).toBeUndefined();
    rejects(travel({ arrivalDate: "2027-01-01", departureDate: "2028-01-03" }), "travel.departureDate", "travel_too_long");
    rejects(travel({ arrivalDate: "0001-01-01", departureDate: "9999-12-31" }), "travel.departureDate", "travel_too_long");
  });
  it("rejects_invalid_windows_even_at_the_direct_boundary", () => {
    rejects(travel({ arrivalWindow: "evening" as TimeWindow }), "travel.arrivalWindow", "invalid_window");
    rejects(travel({ departureWindow: "evening" as TimeWindow }), "travel.departureWindow", "invalid_window");
  });
});
