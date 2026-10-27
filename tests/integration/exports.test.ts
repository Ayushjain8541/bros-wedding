import { randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  withTestDb,
  seedOrganizer,
  seedGuestSession,
} from "../helpers/database";
import { acceptedInput } from "../fixtures/wedding";
import { createRsvp } from "@/features/rsvp/service";
import { readAllResponses } from "@/features/organizer/responses";
const origin = process.env.TEST_APP_ORIGIN!;
const get = (path: string, cookie?: string) =>
  fetch(origin + path, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
test("real Auth protects exports/metrics; full snapshot exceeds pagination, edits recalculate, no public files", async () =>
  withTestDb(async (db) => {
    const publicBefore = await readdir("public", { recursive: true });
    const guest = await seedGuestSession("group-1", db),
      admin = await seedOrganizer(db);
    for (const path of [
      "/api/admin/metrics",
      "/api/admin/exports/guests",
      "/api/admin/exports/parties",
    ]) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, `wedding_guest=${guest.cookie}`)).status).toBe(
        401,
      );
      await db`delete from wedding.organizer_users where user_id=${admin.actor.userId}`;
      expect((await get(path, admin.cookieHeader)).status).toBe(403);
      await expect(readAllResponses(admin.actor, db)).rejects.toMatchObject({
        status: 403,
      });
      await db`insert into wedding.organizer_users(user_id) values(${admin.actor.userId})`;
    }
    const ids: string[] = [];
    for (let i = 0; i < 51; i++)
      ids.push(
        (
          await createRsvp(
            guest.actor,
            "group-1",
            {
              requestId: randomUUID(),
              editToken: randomBytes(32).toString("base64url"),
              response: acceptedInput(),
            },
            db,
          )
        ).id,
      );
    expect(await readAllResponses(admin.actor, db)).toHaveLength(51);
    const result = await get("/api/admin/metrics", admin.cookieHeader);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(await result.json()).toMatchObject({
      acceptingSubmissions: 51,
      attendingGuests: 153,
      guestNights: 306,
      eventGuests: { haldi: 153 },
    });
    const patch = await fetch(`${origin}/api/admin/responses/${ids[0]}`, {
      method: "PATCH",
      headers: {
        Cookie: admin.cookieHeader,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedSubmissionId: ids[0],
        expectedVersion: 1,
        response: acceptedInput({ guestNames: ["Asha Jain"] }),
      }),
    });
    expect(patch.status).toBe(200);
    expect(
      await (await get("/api/admin/metrics", admin.cookieHeader)).json(),
    ).toMatchObject({
      attendingGuests: 151,
      guestNights: 302,
      eventGuests: { haldi: 151 },
    });
    for (const [kind, rows] of [
      ["guests", 151],
      ["parties", 51],
    ] as const) {
      const response = await get(
        `/api/admin/exports/${kind}`,
        admin.cookieHeader,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("content-type")).toContain(
        "text/csv; charset=utf-8",
      );
      expect(response.headers.get("content-disposition")).toContain(
        `attachment; filename="wedding-${kind}.csv"`,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
      const lines = new TextDecoder().decode(bytes).trimEnd().split("\r\n");
      expect(lines).toHaveLength(rows + 1);
      if (kind === "parties")
        expect(new Set(lines.slice(1).map((r) => r.split(",")[0])).size).toBe(
          51,
        );
    }
    expect(
      (await get("/api/admin/exports/unknown", admin.cookieHeader)).status,
    ).toBe(404);
    expect(await readdir("public", { recursive: true })).toEqual(publicBefore);
  }));
