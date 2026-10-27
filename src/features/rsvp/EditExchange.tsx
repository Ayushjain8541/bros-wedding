"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  Locale,
  PartySnapshot,
  SiteSettings,
  WeddingEvent,
} from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import {
  errorMessageKey,
  exchangeEditToken,
  readCurrentResponse,
} from "./client";
import { RsvpShell } from "./RsvpShell";
import { RsvpEditor } from "./RsvpForm";
export function EditExchange({
  events = [],
  settings,
  locale,
  accessDenied = false,
}: {
  events?: WeddingEvent[];
  settings?: SiteSettings;
  locale: Locale;
  accessDenied?: boolean;
}) {
  return (
    <RsvpShell locale={locale} settings={settings}>
      {(locale) => (
        <LoadEdit
          events={events}
          settings={settings}
          locale={locale}
          accessDenied={accessDenied}
        />
      )}
    </RsvpShell>
  );
}
function LoadEdit({
  events,
  settings,
  locale,
  accessDenied,
}: {
  events: WeddingEvent[];
  settings?: SiteSettings;
  locale: Locale;
  accessDenied: boolean;
}) {
  const t = useTranslations("Rsvp");
  const errors = useTranslations("Errors");
  const common = useTranslations("Common");
  const started = useRef(false);
  const token = useRef("");
  const exchanged = useRef(false);
  const [snapshot, setSnapshot] = useState<PartySnapshot>();
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(true);
  async function load() {
    setPending(true);
    setFailure(undefined);
    try {
      if (accessDenied) throw new DomainError("ACCESS_DENIED", 401);
      if (token.current && !exchanged.current) {
        await exchangeEditToken(token.current);
        exchanged.current = true;
      }
      setSnapshot(await readCurrentResponse());
    } catch (error) {
      setFailure(error instanceof DomainError ? error.code : "UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current = window.location.hash.slice(1);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one exchange per mounted route, including StrictMode replay
  if (snapshot && settings)
    return (
      <RsvpEditor
        events={events}
        settings={settings}
        locale={locale}
        initial={snapshot}
      />
    );
  const denied = failure === "ACCESS_DENIED" || failure === "forbidden";
  return (
    <section>
      {pending ? (
        <p role="status">{t("loadingResponse")}</p>
      ) : (
        <>
          <h2>{t("loadFailed")}</h2>
          <p role="alert">
            {errors(errorMessageKey(failure ?? "UNAVAILABLE"))}
          </p>
          {denied ? (
            <p>{t("reopenInstructions")}</p>
          ) : (
            <button type="button" onClick={() => void load()}>
              {common("retry")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
