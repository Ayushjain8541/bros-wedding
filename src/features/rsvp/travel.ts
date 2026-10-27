import { z } from "zod";
import type { Travel } from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";

const windows = ["before-noon", "noon-5pm", "5-9pm", "after-9pm"] as const;
const dayMilliseconds = 86_400_000;

function calendarDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) return;
  return milliseconds / dayMilliseconds;
}

const calendarDate = z.string({ error: "invalid_date" }).refine((value) => calendarDay(value) !== undefined, "invalid_date");
const window = z.enum(windows, { error: "invalid_window" });

// Shared by the strict RSVP schema and the direct travel boundary.
export const travelSchema = z.strictObject({
  arrivalDate: calendarDate,
  arrivalWindow: window,
  departureDate: calendarDate,
  departureWindow: window,
}, { error: (issue) => issue.input === undefined ? "required" : "invalid_type" }).superRefine((travel, context) => {
  const arrival = calendarDay(travel.arrivalDate);
  const departure = calendarDay(travel.departureDate);
  if (arrival === undefined || departure === undefined) return;
  if (departure < arrival) {
    context.addIssue({ code: "custom", path: ["departureDate"], message: "travel_order" });
  } else if (departure - arrival > 366) {
    context.addIssue({ code: "custom", path: ["departureDate"], message: "travel_too_long" });
  } else if (departure === arrival && windows.indexOf(travel.departureWindow) < windows.indexOf(travel.arrivalWindow)) {
    context.addIssue({ code: "custom", path: ["departureWindow"], message: "travel_order" });
  }
});

export function validateTravel(travel: Travel): void {
  const result = travelSchema.safeParse(travel);
  if (result.success) return;
  const fields: Record<string, string[]> = Object.create(null);
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields[["travel", ...issue.path, key].join(".")] = ["unknown_field"];
    } else {
      const path = ["travel", ...issue.path].join(".");
      (fields[path] ??= []).push(issue.message);
    }
  }
  throw new DomainError("VALIDATION_FAILED", 422, fields);
}
