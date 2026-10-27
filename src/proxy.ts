import { NextRequest, NextResponse } from "next/server";
import { createRequestClient } from "@/lib/supabase/server";
import { privateHeaders } from "@/lib/http";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const client = createRequestClient({
    getAll: () => request.cookies.getAll(),
    setAll: (values, headers) => {
      for (const { name, value } of values) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of values)
        response.cookies.set(name, value, options);
      for (const [name, value] of Object.entries(headers))
        response.headers.set(name, value);
    },
  });
  // getUser verifies the identity with Auth, and refreshes through SDK cookie adapters.
  await client.auth.getUser();
  for (const [name, value] of Object.entries(privateHeaders))
    response.headers.set(name, value);
  return response;
}
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
