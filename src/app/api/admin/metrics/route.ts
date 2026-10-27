import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/server";
import { requireOrganizer } from "@/features/organizer/auth";
import { readAllResponses } from "@/features/organizer/responses";
import { computeMetrics } from "@/features/organizer/metrics";
import { privateHeaders, rsvpErrorResponse } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = getDb(),
      actor = await requireOrganizer(db);
    return NextResponse.json(
      computeMetrics(await readAllResponses(actor, db)),
      { headers: privateHeaders },
    );
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
