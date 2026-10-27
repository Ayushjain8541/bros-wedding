import 'server-only';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { readEnv } from '@/lib/env';
import { DomainError } from '@/lib/errors';

type HttpEnvironment = Record<string, string | undefined>;
const loopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

export function assertSameOrigin(request: Request): void {
  if (request.headers.get('origin') !== readEnv().APP_ORIGIN) throw new DomainError('FORBIDDEN_ORIGIN', 403);
}

/**
 * Vercel sets this header at its edge (https://vercel.com/docs/headers/request-headers).
 * Trust it only in the actual Vercel runtime. Local tests share one loopback bucket;
 * self-hosted remote deployments require a trusted socket/proxy adapter, not XFF.
 */
export function accessRateLimitKey(request: Request, env: HttpEnvironment = process.env): string {
  if (loopback(new URL(env.APP_ORIGIN!))) return 'access:loopback';
  if (env.VERCEL === '1') {
    const ip = request.headers.get('x-vercel-forwarded-for')?.trim();
    if (ip && isIP(ip)) {
      // Canonicalize IPv6 spelling so equivalent addresses share one bucket.
      const normalized = isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip;
      return `access:${normalized}`;
    }
  }
  throw new DomainError('TRUSTED_CLIENT_IP_UNAVAILABLE', 503);
}

export function guestCookieSecure(env: HttpEnvironment = process.env): boolean {
  const origin = new URL(env.APP_ORIGIN!);
  if (env.ALLOW_INSECURE_LOCAL_COOKIES === 'true') {
    if (!loopback(origin)) throw new DomainError('INVALID_SERVER_CONFIGURATION', 500);
    if (origin.protocol === 'http:') return false;
  }
  return true;
}

export async function readLimitedJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new DomainError('JSON_REQUIRED', 415);
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new DomainError('REQUEST_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('INVALID_REQUEST', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new DomainError('REQUEST_TOO_LARGE', 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('INVALID_REQUEST', 400);
  } finally { reader.releaseLock(); }
}

/** Existing group-code exchange retains its narrower payload limit. */
export function readSmallJson(request: Request): Promise<unknown> {
  return readLimitedJson(request, 1024);
}

/** Never serialize an infrastructure error, token, query or stack to a guest. */
export function rsvpErrorResponse(error: unknown): NextResponse {
  const safe = error instanceof DomainError && error.status < 500;
  const status = safe ? error.status : 503;
  return NextResponse.json({ code: safe ? error.code : 'RSVP_UNAVAILABLE', ...(safe && error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, {
    status,
    headers: { ...privateHeaders, ...(status === 429 ? { 'Retry-After': '900' } : status === 503 ? { 'Retry-After': '5' } : {}) },
  });
}
