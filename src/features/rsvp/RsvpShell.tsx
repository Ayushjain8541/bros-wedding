"use client";
import { useState, type ReactNode } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { Locale, SiteSettings } from "@/features/wedding/types";
import { LanguageToggle } from "@/features/invitation/LanguageToggle";
import en from "@/i18n/messages/en.json";
import hi from "@/i18n/messages/hi.json";
import styles from "./RsvpForm.module.css";
export function RsvpShell({
  locale: initialLocale,
  settings,
  children,
}: {
  locale: Locale;
  settings?: SiteSettings;
  children: (locale: Locale) => ReactNode;
}) {
  const [locale, setLocale] = useState(initialLocale);
  function changeLocale(next: Locale) {
    document.cookie = `locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = next;
    setLocale(next);
  }
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "hi" ? hi : en}
      timeZone="Asia/Kolkata"
    >
      <div className={styles.page} lang={locale}>
        <header className={styles.header}>
          <BackLink />
          <LanguageToggle locale={locale} onChange={changeLocale} />
        </header>
        <main className={styles.sheet}>
          <Title />
          {children(locale)}
        </main>
        {settings && <Help settings={settings} />}
      </div>
    </NextIntlClientProvider>
  );
}
function BackLink() {
  const t = useTranslations("Rsvp");
  return <a href="/invitation?opened=1#welcome">{t("backInvitation")}</a>;
}
function Title() {
  const t = useTranslations("Rsvp");
  return <h1>{t("title")}</h1>;
}
function Help({ settings }: { settings: SiteSettings }) {
  const t = useTranslations("Rsvp");
  return (
    <footer className={styles.footer}>
      <p>{t("help")}</p>
      <a href={settings.helpWhatsAppUrl}>{t("contactHelp")}</a>
    </footer>
  );
}
