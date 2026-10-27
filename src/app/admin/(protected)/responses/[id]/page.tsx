import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/server";
import { requireOrganizerPage } from "@/features/organizer/page-auth";
import { readResponse } from "@/features/organizer/responses";
import { ResponseEditor } from "@/features/organizer/ResponseEditor";
import { readInvitation } from "@/features/wedding/repository";
import { DomainError } from "@/lib/errors";
export default async function ResponsePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const db = getDb(),
    actor = await requireOrganizerPage(db),
    { id } = await params;
  const party =
    id === "new"
      ? undefined
      : await readResponse(actor, id, db).catch((error) => {
          if (error instanceof DomainError && [400, 404].includes(error.status))
            notFound();
          throw error;
        });
  const { events, settings } = await readInvitation("group-1", db);
  return (
    <ResponseEditor
      key={party?.id ?? "new"}
      party={party}
      events={events}
      settings={settings}
    />
  );
}
