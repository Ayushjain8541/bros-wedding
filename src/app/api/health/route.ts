/** A readiness signal only; deliberately does not query data or expose environment. */
export function GET(): Response {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
