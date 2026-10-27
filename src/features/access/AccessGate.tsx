"use client";
import { useState } from "react";
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/features/wedding/types";
import { LanguageToggle } from "@/features/invitation/LanguageToggle";
import { InviteExchange } from "./InviteExchange";
import en from "@/i18n/messages/en.json";
import hi from "@/i18n/messages/hi.json";

/** Only generic dictionary copy is available before invitation authorization. */
export function AccessGate({ exchange = false }: { exchange?: boolean }) {
  const initialLocale = useLocale();
  const [locale, setLocale] = useState<Locale>(initialLocale === "hi" ? "hi" : "en");
  function changeLocale(next: Locale) {
    document.cookie = `locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = next;
    setLocale(next);
  }
  return <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hi : en} timeZone="Asia/Kolkata">
    <main lang={locale}>
      <LanguageToggle locale={locale} onChange={changeLocale}/>
      <GateCopy exchange={exchange}/>
    </main>
  </NextIntlClientProvider>;
}
function GateCopy({ exchange }: { exchange: boolean }) {
  const t = useTranslations("Access");
  return <><h1>{t("title")}</h1>{exchange ? <InviteExchange/> : <p>{t("instructions")}</p>}</>;
}
