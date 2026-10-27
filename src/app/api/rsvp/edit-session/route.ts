import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { requireGuest } from '@/features/access/service';
import { consumeRateLimit } from '@/features/access/rate-limit';
import { exchangeEditToken } from '@/features/rsvp/edit-access';
import { accessRateLimitKey, assertSameOrigin, guestCookieSecure, privateHeaders, readLimitedJson, rsvpErrorResponse } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const secure = guestCookieSecure();
    const db = getDb();
    const guest = await requireGuest(request.cookies.get('wedding_guest')?.value, db);
    await consumeRateLimit(`rsvp:exchange:ip:${accessRateLimitKey(request)}`, 5, 900, db);
    const body = await readLimitedJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1
      || !('token' in body) || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw new DomainError('INVALID_REQUEST', 400);
    const { sessionToken, expiresAt } = await exchangeEditToken(body.token, guest, db);
    const response = NextResponse.json({}, { headers: privateHeaders });
    response.cookies.set('wedding_edit', sessionToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: new Date(expiresAt) });
    return response;
  } catch (error) { return rsvpErrorResponse(error); }
}
