import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { requireGuest } from '@/features/access/service';
import { consumeRateLimit } from '@/features/access/rate-limit';
import { createRsvp } from '@/features/rsvp/service';
import { accessRateLimitKey, assertSameOrigin, privateHeaders, readLimitedJson, rsvpErrorResponse } from '@/lib/http';
import type { CreateCommand } from '@/features/wedding/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const db = getDb();
    const guest = await requireGuest(request.cookies.get('wedding_guest')?.value, db);
    await consumeRateLimit(`rsvp:create:ip:${accessRateLimitKey(request)}`, 10, 900, db);
    await consumeRateLimit(`rsvp:create:guest:${guest.sessionId}`, 10, 900, db);
    const body = await readLimitedJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 3
      || !('requestId' in body) || typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)
      || !('editToken' in body) || typeof body.editToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.editToken)
      || !('response' in body)) throw new DomainError('INVALID_REQUEST', 400);
    const result = await createRsvp(guest, guest.groupId, body as CreateCommand, db);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) { return rsvpErrorResponse(error); }
}
