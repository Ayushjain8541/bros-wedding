import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
if (process.argv.includes("--help")) {
  console.log(
    "Load trusted server env, then set ORGANIZER_EMAIL and ORGANIZER_PASSWORD and run node scripts/provision-organizer.mjs --provision. Creates a confirmed Auth user and allowlists its UUID in DATABASE_URL. Sends no email. Never put passwords on the command line.",
  );
  process.exit(0);
}
if (!process.argv.includes("--provision"))
  throw new Error("EXPLICIT_PROVISION_FLAG_REQUIRED");
if (
  !process.env.ORGANIZER_EMAIL ||
  !process.env.ORGANIZER_PASSWORD ||
  process.env.ORGANIZER_PASSWORD.length < 16
)
  throw new Error("ORGANIZER_EMAIL_AND_STRONG_PASSWORD_REQUIRED");
const target = new URL(process.env.DATABASE_URL ?? "");
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  target.username !== "wedding_app"
)
  throw new Error("RESTRICTED_DATABASE_REQUIRED");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
const db = postgres(target.href, {
  max: 1,
  ssl: local ? false : { rejectUnauthorized: true },
  onnotice: () => {},
});
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
let created;
try {
  const result = await client.auth.admin.createUser({
    email: process.env.ORGANIZER_EMAIL,
    password: process.env.ORGANIZER_PASSWORD,
    email_confirm: true,
  });
  if (result.error || !result.data.user)
    throw new Error("AUTH_PROVISION_FAILED");
  created = result.data.user.id;
  await db`insert into wedding.organizer_users(user_id) values(${created}) on conflict do nothing`;
  console.log("Organizer account created and allowlisted. No email was sent.");
} catch {
  if (created) await client.auth.admin.deleteUser(created);
  throw new Error("ORGANIZER_PROVISION_FAILED");
} finally {
  await db.end({ timeout: 2 });
}
