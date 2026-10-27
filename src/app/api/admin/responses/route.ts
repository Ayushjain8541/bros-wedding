import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/server";
import { requireOrganizer } from "@/features/organizer/auth";
import {
  listResponses,
  parseAdminFilters,
} from "@/features/organizer/responses";
import { createRsvp } from "@/features/rsvp/service";
import { consumeRateLimit } from "@/features/access/rate-limit";
import { DomainError } from "@/lib/errors";
import {
  assertSameOrigin,
  privateHeaders,
  readLimitedJson,
  rsvpErrorResponse,
} from "@/lib/http";
import type { CreateCommand } from "@/features/wedding/types";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const db = getDb(),
      actor = await requireOrganizer(db);
    return NextResponse.json(
      await listResponses(
        actor,
        parseAdminFilters(request.nextUrl.searchParams),
        db,
      ),
      { headers: privateHeaders },
    );
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const db = getDb(),
      actor = await requireOrganizer(db);
    await consumeRateLimit(`organizer-write:${actor.userId}`, 100, 900, db);
    const parsed = z
      .object({
        groupId: z.enum(["group-1", "group-2"]),
        source: z.enum(["phone", "whatsapp"]),
        overrideReason: z.string().trim().max(2000).optional(),
        command: z
          .object({
            requestId: z.uuid(),
            editToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
            response: z.unknown(),
          })
          .strict(),
      })
      .strict()
      .safeParse(await readLimitedJson(request));
    if (!parsed.success || request.nextUrl.search)
      throw new DomainError("INVALID_REQUEST", 400);
    const body = parsed.data;
    const result = await createRsvp(
      actor,
      body.groupId,
      body.command as CreateCommand,
      db,
      { source: body.source, reason: body.overrideReason },
    );
    // Manual records do not distribute guest edit credentials through this endpoint.
    return NextResponse.json(
      {
        id: result.id,
        version: result.version,
        duplicateWarning: result.duplicateWarning,
      },
      { status: 201, headers: privateHeaders },
    );
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
