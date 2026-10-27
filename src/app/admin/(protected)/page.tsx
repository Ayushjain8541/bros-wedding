import { Dashboard } from "@/features/organizer/Dashboard";
import { getDb } from "@/lib/db/server";
import { requireOrganizerPage } from "@/features/organizer/page-auth";
import {
  listResponses,
  parseAdminFilters,
} from "@/features/organizer/responses";
import { ResponsesTable } from "@/features/organizer/ResponsesTable";
import { readInvitation } from "@/features/wedding/repository";
export default async function ResponsesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = getDb(),
    actor = await requireOrganizerPage(db);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === "string" && v !== "") params.set(k, v);
  const filters = parseAdminFilters(params),
    result = await listResponses(actor, filters, db);
  const { events } = await readInvitation("group-1", db);
  return (
    <>
      <Dashboard events={events} />
      <ResponsesTable {...result} filters={filters} events={events} />
    </>
  );
}
