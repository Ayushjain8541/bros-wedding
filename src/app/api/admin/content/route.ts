import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/server";
import { requireOrganizer } from "@/features/organizer/auth";
import {
  readContent,
  saveContent,
  type ContentPatch,
} from "@/features/organizer/content";
import {
  assertSameOrigin,
  privateHeaders,
  readLimitedJson,
  rsvpErrorResponse,
} from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = getDb();
    return NextResponse.json(
      await readContent(await requireOrganizer(db), db),
      { headers: privateHeaders },
    );
  } catch (e) {
    return rsvpErrorResponse(e);
  }
}
export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const db = getDb(),
      actor = await requireOrganizer(db);
    const result = await saveContent(
      actor,
      (await readLimitedJson(request, 256 * 1024)) as ContentPatch,
      db,
    );
    revalidatePath("/invitation");
    revalidatePath("/rsvp");
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (e) {
    return rsvpErrorResponse(e);
  }
}
