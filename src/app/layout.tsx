import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "@fontsource/cormorant-garamond/latin-400.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/noto-sans-devanagari/latin-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Private invitation",
  robots: { index: false, follow: false, nocache: true },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body><NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Kolkata">{children}</NextIntlClientProvider></body>
    </html>
  );
}
