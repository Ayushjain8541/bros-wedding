import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import type { Locale } from "@/features/wedding/types";

export default getRequestConfig(async () => {
  const requested = (await cookies()).get("locale")?.value;
  const locale: Locale = requested === "hi" ? "hi" : "en";
  return { locale, timeZone: "Asia/Kolkata", messages: (await import(`./messages/${locale}.json`)).default };
});
