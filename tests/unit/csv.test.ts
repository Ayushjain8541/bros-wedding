import { expect, test } from "vitest";
import { exportGuestsCsv, exportPartiesCsv } from "@/features/organizer/csv";
import { acceptedInput, declinedInput } from "../fixtures/wedding";
import type { PartySnapshot } from "@/features/wedding/types";
const party: PartySnapshot = {
  id: "p1",
  groupId: "group-1",
  version: 1,
  source: "website",
  response: acceptedInput(),
};
// Independent RFC4180 reader: embedded CR/LF and escaped quotes are data.
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && c === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}
test("BOM, one row per accepted person with party association, one row per party, no phantom declining guests", () => {
  const declined: PartySnapshot = {
    ...party,
    id: "p2",
    response: declinedInput(),
  };
  const csv = exportGuestsCsv([party, declined]);
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const rows = parseCsv(csv);
  expect(rows).toHaveLength(4);
  expect(rows.slice(1).map((r) => r[0])).toEqual(["p1", "p1", "p1"]);
  expect(rows.slice(1).map((r) => r[3])).toEqual(acceptedInput().guestNames);
  const parties = parseCsv(exportPartiesCsv([party, declined]));
  expect(parties).toHaveLength(3);
  expect(parties[2]).toContain("decline");
  expect(
    parseCsv(
      exportGuestsCsv([
        { ...party, response: acceptedInput({ guestNames: ["Asha Jain"] }) },
      ]),
    ),
  ).toHaveLength(2);
});
test("RFC quotes, newlines and Unicode round trip; phone digits remain text", () => {
  const input = acceptedInput({
    guestNames: ['आशा, "Jain"\nFamily'],
    questions: 'One, "two"\r\nthree',
  });
  const csv = exportGuestsCsv([{ ...party, response: input }]);
  const rows = parseCsv(csv);
  expect(rows[1][3]).toBe(input.guestNames[0]);
  expect(rows[1]).toContain("'+12025550123");
  expect(csv).toContain('"आशा, ""Jain""\nFamily"');
  expect(
    parseCsv(exportPartiesCsv([{ ...party, response: input }]))[1],
  ).toContain(input.questions);
});
test.each([
  "=1+1",
  "+SUM(A1)",
  "-1+2",
  "@SUM(A1)",
  "\ttext",
  "\rtext",
  "  =HYPERLINK(1)",
  "\n +1",
  " \tword",
])("neutralizes dangerous cell %j across both serializers", (value) => {
  const p = {
    ...party,
    response: acceptedInput({
      contact: { fullName: value, whatsapp: "+12025550123" },
      guestNames: [value],
      questions: value,
      song: { name: value, artist: value, url: value },
    }),
  };
  for (const csv of [exportGuestsCsv([p]), exportPartiesCsv([p])]) {
    expect(parseCsv(csv)[1]).toContain("'" + value);
    expect(parseCsv(csv)[1]).not.toContain(value);
  }
});
