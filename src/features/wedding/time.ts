import type { Locale } from "./types";
/** Numeric ICU fields plus explicit periods keep Node and WebKit hydration stable. */
export function formatEventTime(
  value: string,
  locale: Locale,
  periods: { am: string; pm: string },
) {
  const parts = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(value));
  const hour = parts.find((p) => p.type === "hour")!.value,
    minute = parts.find((p) => p.type === "minute")!.value;
  return `${hour}:${minute} ${new Date(Date.parse(value) + 330 * 60000).getUTCHours() < 12 ? periods.am : periods.pm}`;
}
