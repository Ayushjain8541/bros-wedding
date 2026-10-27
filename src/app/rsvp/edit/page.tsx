import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/server";
import { DomainError } from "@/lib/errors";
import { requireGuest } from "@/features/access/service";
import { readInvitation } from "@/features/wedding/repository";
import { EditExchange } from "@/features/rsvp/EditExchange";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function EditPage() {
  const locale = (await getLocale()) === "hi" ? "hi" : "en";
  const db = getDb();
  const actor = await requireGuest(
    (await cookies()).get("wedding_guest")?.value,
    db,
  ).catch((error) => {
    if (error instanceof DomainError && error.status === 401) return null;
    throw error;
  });
  if (!actor) return <EditExchange locale={locale} accessDenied />;
  const { events, settings } = await readInvitation(actor.groupId, db);
  return <EditExchange events={events} settings={settings} locale={locale} />;
}
