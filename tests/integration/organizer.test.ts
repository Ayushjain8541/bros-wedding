import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  combineChunks,
  createChunks,
  stringFromBase64URL,
  stringToBase64URL,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  withTestDb,
  seedOrganizer,
  seedGuestSession,
} from "../helpers/database";
import { acceptedInput, declinedInput } from "../fixtures/wedding";
import { createRsvp } from "@/features/rsvp/service";
const origin = process.env.TEST_APP_ORIGIN!;
const call = (path: string, method = "GET", body?: unknown, cookie?: string) =>
  fetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
const command = () => ({
  requestId: randomUUID(),
  editToken: randomBytes(32).toString("base64url"),
  response: acceptedInput(),
});
test("real Auth enforces identity, allowlist, metadata distrust, cookie policy and logout", async () =>
  withTestDb(async (db) => {
    expect((await call("/api/admin/responses")).status).toBe(401);
    const guest = await seedGuestSession("group-1", db);
    expect(
      (
        await call(
          "/api/admin/responses",
          "GET",
          undefined,
          `wedding_guest=${guest.cookie}`,
        )
      ).status,
    ).toBe(401);
    const one = await seedOrganizer(db);
    expect(
      (await call("/api/admin/responses", "GET", undefined, one.cookieHeader))
        .status,
    ).toBe(200);
    expect(one.cookieHeader).toContain("sb-");
    const signedIn = await call("/api/admin/session", "POST", {
      email: one.email,
      password: one.password,
    });
    expect(signedIn.status).toBe(200);
    const cookies = signedIn.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toMatch(/SameSite=lax/i);
      expect(cookie).not.toMatch(/Domain=/i);
    }
    expect(signedIn.headers.get("cache-control")).toContain("no-store");

    await db`delete from wedding.organizer_users where user_id=${one.actor.userId}`;
    expect(
      (await call("/api/admin/responses", "GET", undefined, one.cookieHeader))
        .status,
    ).toBe(403);
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );
    await admin.auth.admin.updateUserById(one.actor.userId, {
      user_metadata: { role: "organizer" },
      app_metadata: { role: "organizer" },
    });
    expect(
      (
        await call("/api/admin/session", "POST", {
          email: one.email,
          password: one.password,
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("/api/admin/responses", "GET", undefined, one.cookieHeader))
        .status,
    ).toBe(403);
    await db`insert into wedding.organizer_users(user_id) values(${one.actor.userId})`;
    expect(
      (await call("/api/admin/session", "DELETE", undefined, one.cookieHeader))
        .status,
    ).toBe(200);
    expect(
      (await call("/api/admin/responses", "GET", undefined, one.cookieHeader))
        .status,
    ).toBe(401);
  }));
test("audited organizer can be revoked without losing history and existing Auth cookies cannot read or write", async () =>
  withTestDb(async (db) => {
    const organizer = await seedOrganizer(db);
    await seedGuestSession("group-1", db);
    const body = { groupId: "group-1", command: command(), source: "phone" };
    const created = await call("/api/admin/responses", "POST", body, organizer.cookieHeader);
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const before = await db`select * from wedding.audit_log where organizer_user_id=${organizer.actor.userId}`;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ action: "rsvp.create", submission_id: id });

    await db`delete from wedding.organizer_users where user_id=${organizer.actor.userId}`;
    expect(await db`select * from wedding.audit_log where organizer_user_id=${organizer.actor.userId}`).toEqual(before);
    for (const path of ["/api/admin/responses", `/api/admin/responses/${id}`, "/api/admin/metrics", "/api/admin/content"])
      expect((await call(path, "GET", undefined, organizer.cookieHeader)).status).toBe(403);
    expect((await call("/api/admin/responses", "POST", { ...body, command: command() }, organizer.cookieHeader)).status).toBe(403);
    expect((await call(`/api/admin/responses/${id}`, "PATCH", {
      expectedSubmissionId: id, expectedVersion: 1, response: declinedInput(),
    }, organizer.cookieHeader)).status).toBe(403);
    expect(await db`select id,version from wedding.rsvp_submissions`).toEqual([{ id, version: 1 }]);
    expect(await db`select * from wedding.audit_log where organizer_user_id=${organizer.actor.userId}`).toEqual(before);
  }));

test("real organizer searches literal punctuation, stable 51-party pagination, filters, edits and audited manual override", async () =>
  withTestDb(async (db) => {
    const { cookieHeader, actor } = await seedOrganizer(db);
    const guest = await seedGuestSession("group-1", db);
    const ids = [];
    for (let i = 0; i < 51; i++) {
      const input = command();
      input.response.contact.fullName =
        i === 0
          ? "Asha O'Neill"
          : `Party Number ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;
      ids.push((await createRsvp(guest.actor, "group-1", input, db)).id);
    }
    const first = await (
      await call("/api/admin/responses", "GET", undefined, cookieHeader)
    ).json();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await (
      await call(
        `/api/admin/responses?cursor=${encodeURIComponent(first.nextCursor)}`,
        "GET",
        undefined,
        cookieHeader,
      )
    ).json();
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((x) => x.id)).size,
    ).toBe(51);
    expect(
      (
        await (
          await call(
            `/api/admin/responses?query=${encodeURIComponent("O'Neill")}`,
            "GET",
            undefined,
            cookieHeader,
          )
        ).json()
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await (
          await call(
            `/api/admin/responses?query=${encodeURIComponent("%_' ; --")}`,
            "GET",
            undefined,
            cookieHeader,
          )
        ).json()
      ).items,
    ).toHaveLength(0);
    expect(
      (
        await (
          await call(
            "/api/admin/responses?decision=decline",
            "GET",
            undefined,
            cookieHeader,
          )
        ).json()
      ).items,
    ).toHaveLength(0);
    expect(
      (
        await (
          await call(
            "/api/admin/responses?duplicateOnly=true",
            "GET",
            undefined,
            cookieHeader,
          )
        ).json()
      ).items,
    ).toHaveLength(50);
    const ordinary = await call(
      "/api/admin/responses",
      "POST",
      { groupId: "group-1", command: command(), source: "whatsapp" },
      cookieHeader,
    );
    expect(ordinary.status).toBe(201);
    const ordinaryId = (await ordinary.json()).id;
    expect(
      (
        await db`select source from wedding.rsvp_submissions where id=${ordinaryId}`
      )[0].source,
    ).toBe("whatsapp");
    const id = ids[0];
    expect(
      (
        await call(
          `/api/admin/responses/${id}`,
          "PATCH",
          {
            expectedSubmissionId: ids[1],
            expectedVersion: 1,
            response: declinedInput(),
          },
          cookieHeader,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          `/api/admin/responses/${id}`,
          "PATCH",
          {
            expectedSubmissionId: id,
            expectedVersion: 1,
            response: declinedInput(),
          },
          cookieHeader,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          `/api/admin/responses/${id}`,
          "PATCH",
          {
            expectedSubmissionId: id,
            expectedVersion: 1,
            response: declinedInput(),
          },
          cookieHeader,
        )
      ).status,
    ).toBe(409);
    await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()-interval '1 day'`;
    const body = { groupId: "group-1", command: command(), source: "phone" };
    expect(
      (await call("/api/admin/responses", "POST", body, cookieHeader)).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/admin/responses",
          "POST",
          { ...body, overrideReason: "Family phoned after cutoff" },
          cookieHeader,
        )
      ).status,
    ).toBe(201);
    const audit =
      await db`select organizer_user_id,action,reason,details from wedding.audit_log order by created_at`;
    expect(audit.at(-1)).toMatchObject({
      organizer_user_id: actor.userId,
      action: "rsvp.create",
      reason: "Family phoned after cutoff",
      details: { source: "phone", deadlineOverride: true },
    });
    expect(
      (
        await call(
          "/api/admin/responses",
          "POST",
          { ...body, overrideReason: "guest" },
          `wedding_guest=${guest.cookie}`,
        )
      ).status,
    ).toBe(401);
    const bad = await fetch(`${origin}/api/admin/responses/${id}`, {
      method: "PATCH",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: "{}",
    });
    expect(bad.status).toBe(403);
  }));
test("login throttles at five real HTTP attempts per 15-minute IP bucket", async () =>
  withTestDb(async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await call("/api/admin/session", "POST", {
            email: "unknown@example.test",
            password: "invalid-password",
          })
        ).status,
      ).toBe(401);
    const blocked = await call("/api/admin/session", "POST", {
      email: "unknown@example.test",
      password: "invalid-password",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
  }));

test("expired stored Auth sessions refresh through SDK cookies; invalid refresh is denied", async () =>
  withTestDb(async (db) => {
    const one = await seedOrganizer(db);
    const pairs = new Map(
      one.cookieHeader.split("; ").map((cookie) => {
        const at = cookie.indexOf("=");
        return [cookie.slice(0, at), cookie.slice(at + 1)];
      }),
    );
    const key = [...pairs.keys()][0].replace(/\.\d+$/, "");
    const raw = await combineChunks(key, (name) => pairs.get(name));
    expect(raw?.startsWith("base64-")).toBe(true);
    const session = JSON.parse(stringFromBase64URL(raw!.slice(7)));
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    const expired = (refresh: string) =>
      createChunks(
        key,
        "base64-" +
          stringToBase64URL(
            JSON.stringify({ ...session, refresh_token: refresh }),
          ),
      )
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
    const refreshed = await call(
      "/api/admin/responses",
      "GET",
      undefined,
      expired(session.refresh_token),
    );
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(refreshed.headers.get("cache-control")).toContain("no-store");
    expect(
      (
        await call(
          "/api/admin/responses",
          "GET",
          undefined,
          expired("expired-invalid-refresh"),
        )
      ).status,
    ).toBe(401);
  }));

test("actual Auth public signup is disabled while admin-provisioned login remains available", async () =>
  withTestDb(async (db) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
      key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const settings = await (
      await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    ).json();
    expect(settings.disable_signup).toBe(true);
    expect(settings.external.email).toBe(true);
    const signup = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `signup-${randomUUID()}@example.test`,
        password: randomBytes(32).toString("base64url"),
      }),
    });
    expect(signup.status).toBe(422);
    expect((await signup.json()).error_code).toBe("signup_disabled");
    const one = await seedOrganizer(db);
    expect(
      (
        await call("/api/admin/session", "POST", {
          email: one.email,
          password: one.password,
        })
      ).status,
    ).toBe(200);
  }));
