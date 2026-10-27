import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/server";
import { requireOrganizer } from "@/features/organizer/auth";
import { DomainError } from "@/lib/errors";
import { LogoutButton } from "@/features/organizer/AdminSession";
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireOrganizer(getDb());
  } catch (error) {
    if (error instanceof DomainError && [401, 403].includes(error.status))
      redirect("/admin/login");
    throw error;
  }
  return (
    <>
      <header>
        <p>Private organizer desk</p>
        <h1>Wedding responses</h1>
        <nav>
          <Link href="/admin">All responses</Link>
          <Link href="/admin/responses/new">Add phone or WhatsApp reply</Link>
          <LogoutButton />
        </nav>
      </header>
      {children}
    </>
  );
}
