import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const config: NextConfig = { poweredByHeader: false, agentRules: false };
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
