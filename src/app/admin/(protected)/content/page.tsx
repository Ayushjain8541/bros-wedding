import { requireOrganizer } from "@/features/organizer/auth";
import { readContent } from "@/features/organizer/content";
import { ContentEditor } from "@/features/organizer/ContentEditor";
import { getDb } from "@/lib/db/server";
export default async function ContentPage() {
  const db = getDb();
  return (
    <ContentEditor
      initial={await readContent(await requireOrganizer(db), db)}
    />
  );
}
