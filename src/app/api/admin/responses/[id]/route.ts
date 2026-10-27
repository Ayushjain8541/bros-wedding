import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/server";
import { requireOrganizer } from "@/features/organizer/auth";
import { readResponse } from "@/features/organizer/responses";
import { updateRsvp } from "@/features/rsvp/service";
import { consumeRateLimit } from "@/features/access/rate-limit";
import { DomainError } from "@/lib/errors";
import {
  assertSameOrigin,
  privateHeaders,
  readLimitedJson,
  rsvpErrorResponse,
} from "@/lib/http";
import type { EditCommand } from "@/features/wedding/types";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const db = getDb(),
      actor = await requireOrganizer(db);
    if (request.nextUrl.search) throw new DomainError("INVALID_REQUEST", 400);
    return NextResponse.json(
      await readResponse(actor, (await context.params).id, db),
      { headers: privateHeaders },
    );
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const db = getDb(),
      actor = await requireOrganizer(db);
    await consumeRateLimit(`organizer-write:${actor.userId}`, 100, 900, db);
    const id = (await context.params).id;
    const parsed = z
      .object({
        expectedSubmissionId: z.uuid(),
        expectedVersion: z.number().int().positive(),
        response: z.unknown(),
      })
      .strict()
      .safeParse(await readLimitedJson(request));
    if (
      !parsed.success ||
      !z.uuid().safeParse(id).success ||
      request.nextUrl.search
    )
      throw new DomainError("INVALID_REQUEST", 400);
    return NextResponse.json(
      await updateRsvp(actor, id, parsed.data as EditCommand, db),
      { headers: privateHeaders },
    );
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
