import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/server";
import { requireGuest } from "@/features/access/service";
import { requireOrganizer } from "@/features/organizer/auth";
import { getPhotoUrl } from "@/lib/storage/server";
import { privateHeaders, rsvpErrorResponse } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = getDb();
    const actor = await requireGuest(
      (await cookies()).get("wedding_guest")?.value,
      db,
    ).catch(() => requireOrganizer(db));
    const url = await getPhotoUrl(actor, (await params).id, db);
    return NextResponse.redirect(url, { status: 307, headers: privateHeaders });
  } catch (e) {
    return rsvpErrorResponse(e);
  }
}
