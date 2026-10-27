import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const testDist = process.env.NEXT_TEST_DIST_DIR;
if (testDist) {
  const db = new URL(process.env.DATABASE_URL ?? "");
  if (!/^\.next-restore-test-[a-z0-9]+$/.test(testDist) || !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/^\/wedding_restore_test_[a-z0-9_]+$/.test(db.pathname)) throw Error("UNSAFE_TEST_DIST_DIR");
}
const config: NextConfig = {
  ...(testDist ? { distDir: testDist, typescript: { tsconfigPath: "tsconfig.restore.json" } } : {}),
  poweredByHeader: false,
  agentRules: false,
  // The route still counts actual bytes and caps multipart at 10 MiB + 32 KiB.
  experimental: { proxyClientMaxBodySize: 11 * 1024 * 1024 },
  // Private photos must never enter the shared image optimizer cache.
  images: { localPatterns: [{ pathname: "/art/**", search: "" }] },
};
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
