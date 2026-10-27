import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/server";
import { requireOrganizer } from "@/features/organizer/auth";
import { uploadPhoto, MAX_PHOTO_BYTES } from "@/lib/storage/server";
import { DomainError } from "@/lib/errors";
import {
  assertSameOrigin,
  privateHeaders,
  rsvpErrorResponse,
} from "@/lib/http";
export const dynamic = "force-dynamic";
// Count actual bytes before parsing multipart. Content-Length is only an early rejection.
async function boundedForm(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(type))
    throw new DomainError("MULTIPART_REQUIRED", 415);
  const limit = MAX_PHOTO_BYTES + 32 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new DomainError("REQUEST_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_REQUEST", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new DomainError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": type },
    }).formData();
  } catch {
    throw new DomainError("INVALID_REQUEST", 400);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const db = getDb(),
      actor = await requireOrganizer(db),
      form = await boundedForm(request);
    const allowed = [
      "photo",
      "alt",
      "provenance",
      "expectedRevision",
      "replacePhotoId",
    ];
    for (const key of form.keys())
      if (!allowed.includes(key) || form.getAll(key).length !== 1)
        throw new DomainError("INVALID_REQUEST", 400);
    const file = form.get("photo"),
      alt = form.get("alt"),
      provenance = form.get("provenance"),
      revision = form.get("expectedRevision"),
      replace = form.get("replacePhotoId");
    if (
      !(file instanceof File) ||
      typeof alt !== "string" ||
      typeof provenance !== "string" ||
      typeof revision !== "string" ||
      !/^[1-9]\d{0,9}$/.test(revision) ||
      (replace !== null && typeof replace !== "string")
    )
      throw new DomainError("INVALID_REQUEST", 400);
    let parsedAlt;
    try {
      parsedAlt = JSON.parse(alt);
    } catch {
      throw new DomainError("INVALID_REQUEST", 400);
    }
    const result = await uploadPhoto(
      actor,
      file,
      parsedAlt,
      provenance,
      {
        expectedRevision: Number(revision),
        ...(replace ? { replacePhotoId: replace } : {}),
      },
      db,
    );
    revalidatePath("/invitation");
    return NextResponse.json(result, { status: 201, headers: privateHeaders });
  } catch (e) {
    return rsvpErrorResponse(e);
  }
}
