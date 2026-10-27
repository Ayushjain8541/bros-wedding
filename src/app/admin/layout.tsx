import styles from "@/features/organizer/Admin.module.css";
export const metadata = {
  title: "Organizer desk",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Presentation only: login is deliberately outside the protected route group. */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className={styles.shell}>{children}</main>;
}
