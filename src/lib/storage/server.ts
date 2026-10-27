import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/lib/db/server";
import type {
  GuestActor,
  OrganizerActor,
  Locale,
  Photo,
} from "@/features/wedding/types";
import { secretSupabase } from "@/lib/supabase/server";
import { DomainError } from "@/lib/errors";
import { assertOrganizer } from "@/features/organizer/auth";
import {
  lockContent,
  photoAltSchema,
  provenanceSchema,
} from "@/features/organizer/content";
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export function photoBucket() {
  const name =
    process.env.PHOTO_BUCKET ??
    (new URL(process.env.DATABASE_URL!).pathname === "/wedding_test"
      ? "wedding-photos-test"
      : "wedding-photos-dev");
  if (!["wedding-photos-test", "wedding-photos-dev"].includes(name))
    throw new DomainError("INVALID_SERVER_CONFIGURATION", 500);
  // Test app must never write dev objects even if its inherited env selected that bucket.
  return new URL(process.env.DATABASE_URL!).pathname === "/wedding_test"
    ? "wedding-photos-test"
    : name;
}
const invalid = () => new DomainError("INVALID_PHOTO", 422);
const commandSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  replacePhotoId: z.uuid().optional(),
});
export type PhotoCommand = z.infer<typeof commandSchema>;
/** Cleanup is post-commit, so failed deletion is recorded as debt, never a false publish failure. */
export async function removePhotoObjects(
  paths: string[],
  actor: OrganizerActor,
  db: Database,
) {
  if (!paths.length) return;
  try {
    const result = await secretSupabase()
      .storage.from(photoBucket())
      .remove(paths);
    if (!result.error) return;
  } catch {
    /* Record bounded recovery metadata below. */
  }
  try {
    await db`insert into wedding.audit_log(organizer_user_id,action,details) values(${actor.userId},'photo.cleanup_pending',${db.json({ paths, bucket: photoBucket() })})`;
  } catch {
    console.error("PHOTO_CLEANUP_REQUIRES_RECONCILIATION");
  }
}
export async function uploadPhoto(
  actor: OrganizerActor,
  file: File,
  alt: Record<Locale, string>,
  provenance: string,
  command: PhotoCommand,
  db: Database,
): Promise<Photo & { revision: number }> {
  await assertOrganizer(actor, db);
  const checked = commandSchema.safeParse(command),
    a = photoAltSchema.safeParse(alt),
    p = provenanceSchema.safeParse(provenance);
  if (
    !checked.success ||
    !a.success ||
    !p.success ||
    !(file instanceof File) ||
    file.size < 12 ||
    file.size > MAX_PHOTO_BYTES
  )
    throw invalid();
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "image/jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        ? "image/webp"
        : null;
  if (!mime || mime !== file.type) throw invalid();
  const id = randomUUID(),
    path = `photos/${id}.${mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp"}`;
  const storage = secretSupabase().storage.from(photoBucket());
  try {
    const uploaded = await storage.upload(path, bytes, {
      contentType: mime,
      cacheControl: "0",
      upsert: false,
    });
    if (uploaded.error) throw new Error("UPLOAD_FAILED");
  } catch {
    await removePhotoObjects([path], actor, db);
    throw new DomainError("PHOTO_UNAVAILABLE", 503);
  }
  let oldPath: string | undefined;
  let result: Photo & { revision: number };
  try {
    result = await db.begin(async (transaction) => {
      const tx = transaction as unknown as Database;
      const current = await lockContent(
        actor,
        checked.data.expectedRevision,
        tx,
      );
      const photos =
        await tx`select * from wedding.content_photos order by position,id`;
      const old = checked.data.replacePhotoId
        ? photos.find((x) => x.id === checked.data.replacePhotoId)
        : undefined;
      if (checked.data.replacePhotoId && !old)
        throw new DomainError("conflict", 409);
      if (!old && photos.length >= 20) throw invalid();
      if (old) {
        oldPath = old.storage_path;
        await tx`delete from wedding.content_photos where id=${old.id}`;
      }
      const photo = {
        id,
        storagePath: path,
        alt: a.data,
        position: old?.position ?? photos.length,
        provenance: p.data,
      };
      await tx`insert into wedding.content_photos(id,storage_path,alt,position,provenance) values(${id},${path},${tx.json(photo.alt)},${photo.position},${photo.provenance})`;
      await tx`update wedding.website_content set revision=revision+1 where singleton`;
      await tx`insert into wedding.audit_log(organizer_user_id,action,details) values(${actor.userId},'photo.publish',${tx.json({ revision: current.revision + 1, previousRevision: current.revision, replacedPhotoId: old?.id ?? null, photo })})`;
      return { ...photo, revision: current.revision + 1 };
    });
  } catch (error) {
    // A lost COMMIT acknowledgement is not proof of rollback. Never delete a
    // potentially referenced object while the database outcome is unavailable.
    try {
      const [referenced] =
        await db`select id from wedding.content_photos where storage_path=${path}`;
      if (!referenced) await removePhotoObjects([path], actor, db);
    } catch {
      console.error("PHOTO_UPLOAD_OUTCOME_REQUIRES_RECONCILIATION");
    }
    throw error;
  }
  if (oldPath) await removePhotoObjects([oldPath], actor, db);
  return result;
}
export async function getPhotoUrl(
  actor: GuestActor | OrganizerActor,
  photoId: string,
  db: Database,
): Promise<string> {
  if (actor?.kind === "organizer") await assertOrganizer(actor, db);
  else if (
    actor?.kind === "guest" &&
    z.uuid().safeParse(actor.sessionId).success
  ) {
    const [session] =
      await db`select s.id from wedding.guest_sessions s join wedding.invitation_groups g on g.id=s.group_id where s.id=${actor.sessionId} and s.group_id=${actor.groupId} and s.revoked_at is null and s.expires_at>clock_timestamp() and s.created_at>=g.rotated_at and g.code_hash is not null`;
    if (!session) throw new DomainError("ACCESS_DENIED", 401);
  } else throw new DomainError("ACCESS_DENIED", 401);
  if (!z.uuid().safeParse(photoId).success)
    throw new DomainError("NOT_FOUND", 404);
  const [photo] =
    await db`select storage_path from wedding.content_photos where id=${photoId}`;
  if (!photo) throw new DomainError("NOT_FOUND", 404);
  const { data, error } = await secretSupabase()
    .storage.from(photoBucket())
    .createSignedUrl(photo.storage_path, 60);
  if (error || !data) throw new DomainError("PHOTO_UNAVAILABLE", 503);
  return data.signedUrl;
}
