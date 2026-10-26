import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getEligibleEvents } from "@/features/wedding/eligibility";
import { getInitialContent, getInitialEvents, getInitialSettings, readWeddingSeed } from "@/features/wedding/defaults";
import { DomainError } from "@/lib/errors";
import { GET } from "@/app/api/health/route";
import { EVENTS } from "../fixtures/wedding";

describe("invitation event authorization", () => {
  it("gives group 1 eight events and group 2 only its six events in order", () => {
    expect(getEligibleEvents("group-1", EVENTS)).toHaveLength(8);
    expect(getEligibleEvents("group-2", EVENTS).map(e => e.id)).toEqual([
      "brides-mayara", "haldi", "grooms-mayara", "reception", "baraat", "phere-sajjan-goth",
    ]);
  });
  it("does not elevate an unknown group", () => {
    expect(getEligibleEvents("unknown" as never, EVENTS)).toEqual([]);
  });
});

describe("safe initial domain content", () => {
  it("defaults to synthetic unapproved content with no shared mutable state", () => {
    const content = getInitialContent();
    expect(content.couple.displayName.en).toBe("Sample Bride & Sample Groom");
    expect(content.hindiApproved).toBe(false);
    expect(content.ceremonyCopyApproved).toBe(false);
    content.story.en = "changed";
    expect(getInitialContent().story.en).toBe("A sample story awaiting the family's approved private content.");
    expect(getInitialSettings().newRsvpClosesAt).toBe("2026-11-30T18:30:00Z");
  });
  it("uses synthetic ISO event windows and safe help links", () => {
    expect(getInitialEvents().map(e => [e.startAt, e.endAt])).toEqual([
      ["2030-02-12T10:30:00Z", null], ["2030-02-13T05:30:00Z", "2030-02-13T07:00:00Z"],
      ["2030-02-13T07:30:00Z", "2030-02-13T10:30:00Z"], ["2030-02-13T11:00:00Z", "2030-02-13T12:30:00Z"],
      ["2030-02-13T14:00:00Z", null], ["2030-02-14T04:30:00Z", "2030-02-14T06:30:00Z"],
      ["2030-02-14T07:30:00Z", "2030-02-14T09:30:00Z"], ["2030-02-14T13:30:00Z", null],
    ]);
    expect(getInitialSettings().helpTelUrl).toBe("tel:+12025550123");
    expect(getInitialSettings().helpWhatsAppUrl).toBe("https://wa.me/12025550123");
  });
});

describe("private operator seed", () => {
  it("rejects malformed or absent seed files without leaking file contents", () => {
    expect(() => readWeddingSeed("/does-not-exist.json")).toThrow(DomainError);
    try { readWeddingSeed("/does-not-exist.json"); } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_WEDDING_SEED", status: 422 });
      expect(String(error)).not.toContain("does-not-exist");
    }
  });
  it("validates complete bilingual seeds and rejects unsafe URLs, event drift, and invalid chronology", () => {
    const directory = mkdtempSync(join(tmpdir(), "wedding-seed-"));
    const path = join(directory, "seed.json");
    const seed = { events: getInitialEvents(), content: getInitialContent(), settings: getInitialSettings() };
    try {
      writeFileSync(path, JSON.stringify(seed));
      expect(readWeddingSeed(path).events).toHaveLength(8);
      const cases = [
        { ...seed, settings: { ...seed.settings, helpWhatsAppUrl: "javascript:alert(1)" } },
        { ...seed, events: seed.events.slice(1) },
        { ...seed, events: seed.events.map(e => e.id === "mehendi" ? { ...e, eligibleGroups: ["group-2"] } : e) },
        { ...seed, events: seed.events.map(e => e.id === "haldi" ? { ...e, endAt: "2000-01-01T00:00:00Z" } : e) },
        { ...seed, content: { ...seed.content, story: { en: "Only English" } } },
        { ...seed, unexpected: "reject unknown fields" },
      ];
      for (const value of cases) {
        writeFileSync(path, JSON.stringify(value));
        expect(() => readWeddingSeed(path)).toThrow("INVALID_WEDDING_SEED");
      }
    } finally { rmSync(directory, { recursive: true }); }
  });
  it.skipIf(!process.env.WEDDING_SEED_FILE || !process.env.WEDDING_SEED_EXPECTED_FILE)("matches the operator's independently checked private canonical fixture", () => {
    const seed = readWeddingSeed(process.env.WEDDING_SEED_FILE!);
    const expected = JSON.parse(readFileSync(process.env.WEDDING_SEED_EXPECTED_FILE!, "utf8"));
    expect(seed.events.map(e => [e.id, new Date(e.startAt).toISOString(), e.endAt === null ? null : new Date(e.endAt).toISOString()])).toEqual(expected.eventWindows);
    expect(seed.content.story.en).toBe(expected.story);
    expect(seed.content.families.en).toBe(expected.families);
    expect(seed.settings).toMatchObject(expected.settings);
  });
});

describe("local test server guard", () => {
  it.each([undefined, "postgres://test:test@example.com/wedding_test", "postgres://test:test@127.0.0.1/production"])("refuses unsafe integration database %s", (database) => {
    const result = spawnSync(process.execPath, ["scripts/test-integration.mjs"], {
      env: { ...process.env, TEST_DATABASE_URL: database ?? "" }, encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TEST_DATABASE_URL must target a dedicated loopback test database");
    expect(result.stderr).not.toContain("test:test@");
  });
});

 it("health readiness reveals only a boolean and disables caching", async () => {
  const response = GET();
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
