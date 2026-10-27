import type { PartySnapshot } from "@/features/wedding/types";
/** Apostrophe is a literal text prefix in spreadsheets, including E.164/leading-zero phones. */
function cell(value: string | number, forceText = false): string {
  let text = String(value);
  if (forceText || /^[\s]*[=+@-]/u.test(text) || /^[\s]*[\t\r]/u.test(text))
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function csv(
  headers: string[],
  rows: (string | number)[][],
  phoneIndex: number,
): string {
  return (
    "\uFEFF" +
    [
      headers.map((h) => cell(h)).join(","),
      ...rows.map((row) =>
        row.map((v, i) => cell(v, i === phoneIndex)).join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}
const headers = ["Submission ID", "Invitation group", "Source"];
export function exportGuestsCsv(parties: readonly PartySnapshot[]): string {
  return csv(
    [
      ...headers,
      "Guest name",
      "Contact name",
      "WhatsApp",
      "Events",
      "Arrival date",
      "Arrival window",
      "Departure date",
      "Departure window",
    ],
    parties.flatMap((p) => {
      const r = p.response;
      if (r.decision === "decline") return [];
      return r.guestNames.map((name) => [
        p.id,
        p.groupId,
        p.source,
        name,
        r.contact.fullName,
        r.contact.whatsapp,
        r.eventIds.join("; "),
        r.travel.arrivalDate,
        r.travel.arrivalWindow,
        r.travel.departureDate,
        r.travel.departureWindow,
      ]);
    }),
    5,
  );
}
export function exportPartiesCsv(parties: readonly PartySnapshot[]): string {
  return csv(
    [
      ...headers,
      "Revision",
      "Decision",
      "Contact name",
      "WhatsApp",
      "Guests",
      "Guest names",
      "Events",
      "Arrival date",
      "Arrival window",
      "Departure date",
      "Departure window",
      "Questions",
      "Song name",
      "Song artist",
      "Song URL",
      "Decline note",
    ],
    parties.map((p) => {
      const r = p.response;
      return [
        p.id,
        p.groupId,
        p.source,
        p.version,
        r.decision,
        r.contact.fullName,
        r.contact.whatsapp,
        ...(r.decision === "accept"
          ? [
              r.guestNames.length,
              r.guestNames.join("; "),
              r.eventIds.join("; "),
              r.travel.arrivalDate,
              r.travel.arrivalWindow,
              r.travel.departureDate,
              r.travel.departureWindow,
              r.questions ?? "",
              r.song?.name ?? "",
              r.song?.artist ?? "",
              r.song?.url ?? "",
              "",
            ]
          : [0, "", "", "", "", "", "", "", "", "", "", r.note ?? ""]),
      ];
    }),
    6,
  );
}
