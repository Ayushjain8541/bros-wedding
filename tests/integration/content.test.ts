import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { saveContent, readContent } from "@/features/organizer/content";
import { uploadPhoto, getPhotoUrl } from "@/lib/storage/server";
import { readInvitation } from "@/features/wedding/repository";
import {
  createPartyFixture,
  seedOrganizer,
  seedGuestSession,
  withTestDb,
  withTestAdmin,
} from "../helpers/database";
const origin = process.env.TEST_APP_ORIGIN!;
const png = () =>
  new File(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    "photo.png",
    { type: "image/png" },
  );
const alt = { en: "Synthetic sample", hi: "उदाहरण" };
describe("versioned editorial snapshot", () => {
  it("publishes coherent values, audits, rejects stale or invalid full snapshots and preserves RSVP history", async () =>
    withTestDb(async (db) => {
      const { actor } = await seedOrganizer(db);
      await createPartyFixture("group-2", db);
      const initial = await readContent(actor, db);
      const patch = {
        ...structuredClone(initial),
        expectedRevision: initial.content.revision,
      };
      const haldi = patch.events.find((e) => e.id === "haldi")!;
      haldi.dressCode = { en: "Pastels", hi: "हल्के रंग" };
      haldi.title = { en: "Edited Haldi", hi: "हल्दी" };
      haldi.startAt = "2030-02-13T08:00:00Z";
      patch.content.labels.hi.story = "हमारी कहानी";
      expect(await saveContent(actor, patch, db)).toEqual({ revision: 2 });
      const invitation = await readInvitation("group-2", db);
      expect(invitation.events.find((e) => e.id === "haldi")).toMatchObject({
        ...haldi,
        startAt: new Date(haldi.startAt).toISOString(),
      });
      expect(invitation.content.labels.hi.story).toBe("हमारी कहानी");
      await expect(saveContent(actor, patch, db)).rejects.toMatchObject({
        status: 409,
      });
      const base = { ...(await readContent(actor, db)), expectedRevision: 2 };
      for (const mutate of [
        (p: typeof base) => {
          p.events[2].startAt = "2030-02-14T08:00:00Z";
        },
        (p: typeof base) => {
          p.events[2].startAt = "2030-02-13T04:00:00Z";
        },
        (p: typeof base) => {
          p.events[2].eligibleGroups = ["group-1"];
        },
        (p: typeof base) => {
          p.content.welcome.en = "<script>bad</script>";
        },
        (p: typeof base) => {
          p.content.wedding.mapUrl = "javascript:alert(1)";
        },
        (p: typeof base) => {
          p.settings.newRsvpClosesAt = "tomorrow";
        },
        (p: typeof base) => {
          p.content.story.en = "Changed without approval";
        },
        (p: typeof base) => {
          p.content.labels.en.story = "{unknown}";
        },
        (p: typeof base) => {
          p.content.labels.en.unknown = "unsupported";
        },
        (p: typeof base) => {
          p.content.labels.en.story = "<b>Story</b>";
        },
        (p: typeof base) => {
          p.settings.newRsvpClosesAt = "2026-12-01T18:30:00Z";
        },
        (p: typeof base) => {
          p.content.photos = [
            {
              id: randomUUID(),
              storagePath: "forged.png",
              alt,
              position: 0,
              provenance: "fake",
            },
          ];
        },
      ]) {
        const invalid = structuredClone(base);
        mutate(invalid);
        await expect(saveContent(actor, invalid, db)).rejects.toMatchObject({
          status: 422,
        });
      }
      const guest = await seedGuestSession("group-2", db);
      await expect(
        saveContent(guest.actor as never, base, db),
      ).rejects.toMatchObject({ status: 403 });
      base.events[2].cancelled = true;
      await saveContent(actor, base, db);
      expect(
        (await db`select event_id from wedding.rsvp_event_selections`)[0]
          .event_id,
      ).toBe("haldi");
      expect(
        await db`select action from wedding.audit_log where action='content.publish'`,
      ).toHaveLength(2);
    }));
  it("real Auth HTTP authorization, Origin, explicit story confirmation and conflict", async () =>
    withTestDb(async (db) => {
      const organizer = await seedOrganizer(db);
      const state = await readContent(organizer.actor, db),
        patch = {
          ...state,
          expectedRevision: 1,
          confirmEnglishStoryChange: true,
        };
      patch.content.story.en = "Confirmed story";
      expect((await fetch(`${origin}/api/admin/content`)).status).toBe(401);
      expect(
        (
          await fetch(`${origin}/api/admin/content`, {
            method: "PATCH",
            headers: {
              Cookie: organizer.cookieHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(patch),
          })
        ).status,
      ).toBe(403);
      const send = () =>
        fetch(`${origin}/api/admin/content`, {
          method: "PATCH",
          headers: {
            Origin: origin,
            Cookie: organizer.cookieHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patch),
        });
      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(409);
    }));
  it("private real Storage upload, signed access, replacement race and rejected file types", async () =>
    withTestDb(async (db) => {
      const { actor, cookieHeader } = await seedOrganizer(db);
      const guest = await seedGuestSession("group-1", db);
      const photo = await uploadPhoto(
        actor,
        png(),
        alt,
        "Synthetic fixture",
        { expectedRevision: 1 },
        db,
      );
      expect(photo.revision).toBe(2);
      const url = await getPhotoUrl(guest.actor, photo.id, db);
      expect((await fetch(url)).status).toBe(200);
      expect(
        (
          await fetch(`${origin}/api/photos/${photo.id}`, {
            redirect: "manual",
          })
        ).headers.get("location"),
      ).toBeNull();
      const authorized = await fetch(`${origin}/api/photos/${photo.id}`, {
        headers: { Cookie: `wedding_guest=${guest.cookie}` },
        redirect: "manual",
      });
      expect(authorized.status).toBe(307);
      expect(authorized.headers.get("cache-control")).toContain("no-store");
      const optimizer = `${origin}/_next/image?url=${encodeURIComponent(`/api/photos/${photo.id}`)}&w=640&q=75`;
      for (const headers of [
        new Headers({ Cookie: cookieHeader }),
        new Headers(),
      ]) {
        const denied = await fetch(optimizer, { headers });
        expect(denied.status).toBe(400);
        expect(denied.headers.get("content-type") ?? "").not.toContain(
          "image/",
        );
      }
      for (const file of [
        new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" }),
        new File(["<svg/>"], "bad.png", { type: "image/png" }),
        new File([await png().arrayBuffer()], "bad.jpg", {
          type: "image/jpeg",
        }),
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      ])
        await expect(
          uploadPhoto(
            actor,
            file,
            alt,
            "test",
            { expectedRevision: 2, replacePhotoId: photo.id },
            db,
          ),
        ).rejects.toMatchObject({ status: 422 });
      await expect(
        uploadPhoto(
          actor,
          png(),
          alt,
          "test",
          { expectedRevision: 1, replacePhotoId: photo.id },
          db,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect((await readContent(actor, db)).content.photos).toHaveLength(1);
      expect((await fetch(await getPhotoUrl(actor, photo.id, db))).status).toBe(
        200,
      );
      const form = new FormData();
      form.set("photo", png());
      form.set("alt", JSON.stringify(alt));
      form.set("provenance", "Synthetic fixture");
      form.set("expectedRevision", "2");
      form.set("replacePhotoId", photo.id);
      const replaced = await fetch(`${origin}/api/admin/photos`, {
        method: "POST",
        headers: { Origin: origin, Cookie: cookieHeader },
        body: form,
      });
      expect(replaced.status).toBe(201);
      const next = await replaced.json();
      expect(next.revision).toBe(3);
      expect(next.id).not.toBe(photo.id);
      await expect(getPhotoUrl(actor, photo.id, db)).rejects.toMatchObject({
        status: 404,
      });
    }));
});

it("simultaneous replacements have one winner; reference failure rolls back and removes only the new object", async () =>
  withTestDb(async (db) => {
    const { actor, cookieHeader } = await seedOrganizer(db);
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    ).storage.from("wedding-photos-test");
    const photo = await uploadPhoto(
      actor,
      png(),
      alt,
      "Synthetic fixture",
      { expectedRevision: 1 },
      db,
    );
    const before = (await client.list("photos", { limit: 1000 }))
      .data!.map((x) => x.name)
      .sort();
    await withTestAdmin(async (admin) => {
      await admin`alter table wedding.content_photos add constraint fail_reference check(provenance <> 'Forced failure')`;
    });
    await expect(
      uploadPhoto(
        actor,
        png(),
        alt,
        "Forced failure",
        { expectedRevision: 2, replacePhotoId: photo.id },
        db,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (await client.list("photos", { limit: 1000 }))
        .data!.map((x) => x.name)
        .sort(),
    ).toEqual(before);
    expect((await readContent(actor, db)).content.revision).toBe(2);
    expect((await fetch(await getPhotoUrl(actor, photo.id, db))).status).toBe(
      200,
    );
    // The HTTP app has a five-connection pool: exercise actual competing transactions,
    // not only the test helper's single-connection serialization.
    const replace = async (source: string) => {
      const form = new FormData();
      form.set("photo", png());
      form.set("alt", JSON.stringify(alt));
      form.set("provenance", source);
      form.set("expectedRevision", "2");
      form.set("replacePhotoId", photo.id);
      return fetch(`${origin}/api/admin/photos`, {
        method: "POST",
        headers: { Origin: origin, Cookie: cookieHeader },
        body: form,
      });
    };
    const results = await Promise.all([
      replace("Replacement A"),
      replace("Replacement B"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await readContent(actor, db)).content.revision).toBe(3);
    expect((await client.list("photos", { limit: 1000 })).data).toHaveLength(
      before.length,
    );
  }));
it("reconciles preexisting bucket MIME and size restrictions", async () => {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  await withTestDb(async () => {
    expect(
      (
        await client.storage.updateBucket("wedding-photos-test", {
          public: false,
          fileSizeLimit: 20 * 1024 * 1024,
          allowedMimeTypes: ["image/svg+xml"],
        })
      ).error,
    ).toBeNull();
  });
  await withTestDb(async () => {
    const { data } = await client.storage.getBucket("wedding-photos-test");
    expect(data?.public).toBe(false);
    expect(Number(data?.file_size_limit)).toBe(10 * 1024 * 1024);
    expect(data?.allowed_mime_types?.sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});
it("rejects forged multipart fields, mismatched bytes and unauthenticated uploads before publishing", async () =>
  withTestDb(async (db) => {
    const { cookieHeader, actor } = await seedOrganizer(db);
    const form = () => {
      const f = new FormData();
      f.set("photo", png());
      f.set("alt", JSON.stringify(alt));
      f.set("provenance", "Sample");
      f.set("expectedRevision", "1");
      return f;
    };
    expect(
      (
        await fetch(`${origin}/api/admin/photos`, {
          method: "POST",
          headers: { Origin: origin },
          body: form(),
        })
      ).status,
    ).toBe(401);
    const forged = form();
    forged.set("storagePath", "forged.png");
    expect(
      (
        await fetch(`${origin}/api/admin/photos`, {
          method: "POST",
          headers: { Origin: origin, Cookie: cookieHeader },
          body: forged,
        })
      ).status,
    ).toBe(400);
    const duplicate = form();
    duplicate.append("expectedRevision", "1");
    expect(
      (
        await fetch(`${origin}/api/admin/photos`, {
          method: "POST",
          headers: { Origin: origin, Cookie: cookieHeader },
          body: duplicate,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${origin}/api/admin/photos`, {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: cookieHeader,
            "Content-Type": "multipart/form-data; boundary=test",
          },
          body: new Uint8Array(10 * 1024 * 1024 + 32769),
        })
      ).status,
    ).toBe(413);
    expect((await readContent(actor, db)).content.revision).toBe(1);
  }));

it("accepts the exact 10 MiB file boundary through real multipart and the proxy", async () =>
  withTestDb(async (db) => {
    const { cookieHeader } = await seedOrganizer(db),
      bytes = Buffer.alloc(10 * 1024 * 1024);
    bytes.set(new Uint8Array(await png().arrayBuffer()));
    const form = new FormData();
    form.set("photo", new File([bytes], "maximum.png", { type: "image/png" }));
    form.set("alt", JSON.stringify(alt));
    form.set("provenance", "Synthetic padded boundary fixture");
    form.set("expectedRevision", "1");
    expect(
      (
        await fetch(`${origin}/api/admin/photos`, {
          method: "POST",
          headers: { Origin: origin, Cookie: cookieHeader },
          body: form,
        })
      ).status,
    ).toBe(201);
  }));

it("operator reconciles existing bucket restrictions independently of test helper", async () =>
  withTestDb(async () => {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );
    expect(
      (
        await client.storage.updateBucket("wedding-photos-test", {
          public: false,
          fileSizeLimit: 2048,
          allowedMimeTypes: ["image/png"],
        })
      ).error,
    ).toBeNull();
    await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      `import {ensurePrivateBucket} from './scripts/operator.mjs'; import {createClient} from '@supabase/supabase-js'; await ensurePrivateBucket(createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}}),'wedding-photos-test');`,
    ]);
    const { data } = await client.storage.getBucket("wedding-photos-test");
    expect(Number(data?.file_size_limit)).toBe(10 * 1024 * 1024);
    expect(data?.allowed_mime_types?.sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  }));

it("requires explicit deadline approval, regenerates safe help links and saves explicit copy approval flags", async () =>
  withTestDb(async (db) => {
    const { actor } = await seedOrganizer(db),
      initial = await readContent(actor, db);
    for (const url of [
      "not a URL",
      "javascript:alert(1)",
      "https://example.com/<bad>",
      "https://user:password@example.com",
    ]) {
      const patch = { ...structuredClone(initial), expectedRevision: 1 };
      patch.content.wedding.mapUrl = url;
      await expect(saveContent(actor, patch, db)).rejects.toMatchObject({
        status: 422,
      });
    }
    const patch = {
      ...structuredClone(initial),
      expectedRevision: 1,
      confirmDeadlineChange: true,
    };
    patch.settings.newRsvpClosesAt = "2026-12-01T18:30:00Z";
    patch.settings.helpPhone = "+1 2025550124";
    patch.content.ceremonyCopyApproved = true;
    patch.content.hindiApproved = true;
    await saveContent(actor, patch, db);
    const saved = await readContent(actor, db);
    expect(saved.settings).toMatchObject({
      newRsvpClosesAt: "2026-12-01T18:30:00.000Z",
      helpPhone: "+12025550124",
      helpTelUrl: "tel:+12025550124",
      helpWhatsAppUrl: "https://wa.me/12025550124",
    });
    expect(saved.content).toMatchObject({
      hindiApproved: true,
      ceremonyCopyApproved: true,
    });
  }));
it("actual Storage rejection preserves published reference and signed URLs expire after sixty seconds", async () =>
  withTestDb(async (db) => {
    const { actor } = await seedOrganizer(db),
      guest = await seedGuestSession("group-1", db);
    const photo = await uploadPhoto(
      actor,
      png(),
      alt,
      "Synthetic fixture",
      { expectedRevision: 1 },
      db,
    );
    const signed = await getPhotoUrl(guest.actor, photo.id, db),
      token = new URL(signed).searchParams.get("token")!;
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    expect(claims.exp - claims.iat).toBe(60);
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );
    expect(
      (
        await client.storage.updateBucket("wedding-photos-test", {
          public: false,
          fileSizeLimit: 10 * 1024 * 1024,
          allowedMimeTypes: ["image/jpeg"],
        })
      ).error,
    ).toBeNull();
    try {
      await expect(
        uploadPhoto(
          actor,
          png(),
          alt,
          "Rejected by bucket",
          { expectedRevision: 2, replacePhotoId: photo.id },
          db,
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect((await readContent(actor, db)).content.photos[0].id).toBe(
        photo.id,
      );
      expect((await fetch(signed)).status).toBe(200);
    } finally {
      await client.storage.updateBucket("wedding-photos-test", {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      });
    }
    await seedGuestSession("group-1", db);
    await expect(getPhotoUrl(guest.actor, photo.id, db)).rejects.toMatchObject({
      status: 401,
    });
  }));
it("postcommit deletion failure records cleanup debt and still returns successful replacement", async () =>
  withTestDb(async (db) => {
    const { actor } = await seedOrganizer(db),
      photo = await uploadPhoto(
        actor,
        png(),
        alt,
        "Synthetic fixture",
        { expectedRevision: 1 },
        db,
      );
    const original = globalThis.fetch;
    const intercept = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        if (
          init?.method?.toUpperCase() === "DELETE" &&
          String(input).includes("/storage/v1/object/")
        )
          return Promise.resolve(
            new Response(JSON.stringify({ message: "Synthetic unavailable" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            }),
          );
        return original(input, init);
      });
    try {
      const replacement = await uploadPhoto(
        actor,
        png(),
        alt,
        "Replacement",
        { expectedRevision: 2, replacePhotoId: photo.id },
        db,
      );
      expect(replacement.revision).toBe(3);
      expect((await readContent(actor, db)).content.photos[0].id).toBe(
        replacement.id,
      );
      expect(
        (
          await db`select details from wedding.audit_log where action='photo.cleanup_pending'`
        )[0].details.paths,
      ).toEqual([photo.storagePath]);
    } finally {
      intercept.mockRestore();
    }
  }));
