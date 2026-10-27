import { getDb } from "@/lib/db/server";
import { requireOrganizer } from "@/features/organizer/auth";
import { readAllResponses } from "@/features/organizer/responses";
import { exportGuestsCsv, exportPartiesCsv } from "@/features/organizer/csv";
import { privateHeaders, rsvpErrorResponse } from "@/lib/http";
import { DomainError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const db = getDb(),
      actor = await requireOrganizer(db),
      { kind } = await params;
    if (kind !== "guests" && kind !== "parties")
      throw new DomainError("NOT_FOUND", 404);
    const parties = await readAllResponses(actor, db);
    const bytes = new TextEncoder().encode(
      (kind === "guests" ? exportGuestsCsv : exportPartiesCsv)(parties),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="wedding-${kind}.csv"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
