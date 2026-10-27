import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/server";
import { serverSupabase } from "@/lib/supabase/server";
import { assertOrganizer, requireOrganizer } from "@/features/organizer/auth";
import { consumeRateLimit } from "@/features/access/rate-limit";
import { DomainError } from "@/lib/errors";
import {
  accessRateLimitKey,
  assertSameOrigin,
  privateHeaders,
  readLimitedJson,
  rsvpErrorResponse,
} from "@/lib/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = getDb();
    await consumeRateLimit(
      `organizer-login:${accessRateLimitKey(request)}`,
      5,
      900,
      db,
    );
    const parsed = z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .safeParse(await readLimitedJson(request, 4096));
    if (!parsed.success) throw new DomainError("INVALID_REQUEST", 400);
    const client = await serverSupabase();
    const { data, error } = await client.auth.signInWithPassword(parsed.data);
    if (error || !data.user) throw new DomainError("ACCESS_DENIED", 401);
    try {
      await assertOrganizer({ kind: "organizer", userId: data.user.id }, db);
    } catch (error) {
      await client.auth.signOut({ scope: "local" });
      throw error;
    }
    return NextResponse.json({}, { headers: privateHeaders });
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await requireOrganizer(getDb());
    const result = await (await serverSupabase()).auth.signOut();
    if (result.error) throw new DomainError("SIGN_OUT_UNAVAILABLE", 503);
    return NextResponse.json({}, { headers: privateHeaders });
  } catch (error) {
    return rsvpErrorResponse(error);
  }
}
