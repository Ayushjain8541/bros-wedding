import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // The route still counts actual bytes and caps multipart at 10 MiB + 32 KiB.
  experimental: { proxyClientMaxBodySize: 11 * 1024 * 1024 },
  // Private photos must never enter the shared image optimizer cache.
  images: { localPatterns: [{ pathname: "/art/**", search: "" }] },
};
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
