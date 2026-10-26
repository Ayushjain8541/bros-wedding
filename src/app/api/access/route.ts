import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { accessRateLimitKey, assertSameOrigin, guestCookieSecure, privateHeaders, readSmallJson } from '@/lib/http';
import { exchangeGroupCode } from '@/features/access/service';
import { consumeRateLimit } from '@/features/access/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new DomainError('JSON_REQUIRED', 415);
    const secure = guestCookieSecure();
    const db = getDb();
    await consumeRateLimit(accessRateLimitKey(request), 5, 900, db);
    const body = await readSmallJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('code' in body) || typeof body.code !== 'string' || Object.keys(body).length !== 1) throw new DomainError('INVALID_REQUEST', 400);
    const { sessionToken, expiresAt } = await exchangeGroupCode(body.code, db);
    const response = NextResponse.json({ redirectTo: '/invitation' }, { headers: privateHeaders });
    response.cookies.set('wedding_guest', sessionToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: new Date(expiresAt) });
    return response;
  } catch (error) {
    const status = error instanceof DomainError ? error.status : 500;
    const code = error instanceof DomainError && status < 500 ? error.code : 'ACCESS_UNAVAILABLE';
    return NextResponse.json({ error: code }, { status, headers: { ...privateHeaders, ...(status === 429 ? { 'Retry-After': '900' } : {}) } });
  }
}
