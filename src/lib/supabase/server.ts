import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { readEnv } from "@/lib/env";
import { guestCookieSecure } from "@/lib/http";
export function createRequestClient(cookieMethods: CookieMethodsServer) {
  const env = readEnv();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        path: "/",
        httpOnly: true,
        secure: guestCookieSecure(),
        sameSite: "lax",
      },
      cookies: cookieMethods,
    },
  );
}
export async function serverSupabase() {
  const store = await cookies();
  return createRequestClient({
    getAll: () => store.getAll(),
    setAll: (values) => {
      for (const { name, value, options } of values) {
        try {
          store.set(name, value, options);
        } catch {
          /* Server Component writes are handled by the request proxy. */
        }
      }
    },
  });
}
/** Server-only secret client; never used to establish request identity. */
export function secretSupabase() {
  const env = readEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
