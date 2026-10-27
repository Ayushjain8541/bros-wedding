import "server-only";
import type { Database } from "@/lib/db/server";
import type { OrganizerActor } from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import { serverSupabase } from "@/lib/supabase/server";
export async function assertOrganizer(
  actor: OrganizerActor,
  db: Database,
): Promise<void> {
  if (
    actor?.kind !== "organizer" ||
    typeof actor.userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      actor.userId,
    )
  )
    throw new DomainError("forbidden", 403);
  const [row] =
    await db`select user_id from wedding.organizer_users where user_id=${actor.userId}`;
  if (!row) throw new DomainError("forbidden", 403);
}
export async function requireOrganizer(db: Database): Promise<OrganizerActor> {
  const client = await serverSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new DomainError("ACCESS_DENIED", 401);
  const actor: OrganizerActor = { kind: "organizer", userId: data.user.id };
  await assertOrganizer(actor, db);
  return actor;
}
