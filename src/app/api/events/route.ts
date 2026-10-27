import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { requireGuest } from '@/features/access/service';
import { readInvitation } from '@/features/wedding/repository';
import { privateHeaders, rsvpErrorResponse } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const guest = await requireGuest(request.cookies.get('wedding_guest')?.value, db);
    const { events } = await readInvitation(guest.groupId, db);
    return NextResponse.json({ events }, { headers: privateHeaders });
  } catch (error) { return rsvpErrorResponse(error); }
}
