import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/errors';
import { requireGuest } from '@/features/access/service';
import { consumeRateLimit } from '@/features/access/rate-limit';
import { requireEditor } from '@/features/rsvp/edit-access';
import { readOwnRsvp, updateRsvp } from '@/features/rsvp/service';
import { assertSameOrigin, privateHeaders, readLimitedJson, rsvpErrorResponse } from '@/lib/http';
import type { EditCommand } from '@/features/wedding/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const guest = await requireGuest(request.cookies.get('wedding_guest')?.value, db);
    const editor = await requireEditor(request.cookies.get('wedding_edit')?.value, guest, db);
    if (request.nextUrl.search) throw new DomainError('INVALID_REQUEST', 400);
    return NextResponse.json(await readOwnRsvp(editor, db), { headers: privateHeaders });
  } catch (error) { return rsvpErrorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const db = getDb();
    const guest = await requireGuest(request.cookies.get('wedding_guest')?.value, db);
    const editor = await requireEditor(request.cookies.get('wedding_edit')?.value, guest, db);
    await consumeRateLimit(`rsvp:edit:${editor.sessionId}`, 20, 900, db);
    if (request.nextUrl.search) throw new DomainError('INVALID_REQUEST', 400);
    const body = await readLimitedJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 3
      || !('expectedSubmissionId' in body) || typeof body.expectedSubmissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.expectedSubmissionId)
      || !('expectedVersion' in body) || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1
      || !('response' in body)) throw new DomainError('INVALID_REQUEST', 400);
    return NextResponse.json(await updateRsvp(editor, editor.submissionId, body as EditCommand, db), { headers: privateHeaders });
  } catch (error) { return rsvpErrorResponse(error); }
}
