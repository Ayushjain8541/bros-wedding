"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  Locale,
  PartySnapshot,
  WeddingEvent,
} from "@/features/wedding/types";
import { ResponseSummary } from "./ReviewStep";
import styles from "./RsvpForm.module.css";
export function SecureEditLink({ editPath }: { editPath: string }) {
  const t = useTranslations("Rsvp");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <div className={styles.editLink}>
      <p>{t("secureEdit")}</p>
      <a href={editPath}>{t("secureLink")}</a>
      <button
        type="button"
        className={styles.secondary}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              new URL(editPath, window.location.origin).href,
            );
            setCopied(true);
            setCopyFailed(false);
          } catch {
            setCopyFailed(true);
          }
        }}
      >
        {t(copied ? "copied" : "copyLink")}
      </button>
      {copyFailed && <p role="status">{t("copyFailed")}</p>}
    </div>
  );
}
export function SavedResponse({
  snapshot,
  editPath,
  events,
  locale,
  duplicateWarning = false,
  onEdit,
}: {
  snapshot: PartySnapshot;
  editPath?: string;
  events: WeddingEvent[];
  locale: Locale;
  duplicateWarning?: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("Rsvp");
  return (
    <>
      <h2 tabIndex={-1} data-result-heading>
        {t("saved")}
      </h2>
      <p>{t("savedNote")}</p>
      {duplicateWarning && <p role="status">{t("duplicate")}</p>}
      <ResponseSummary
        response={snapshot.response}
        events={events}
        locale={locale}
      />
      {editPath && <SecureEditLink editPath={editPath} />}
      <div className={styles.actions}>
        <button type="button" onClick={onEdit}>
          {t("edit")}
        </button>
        <a href="/invitation?opened=1#welcome">{t("backInvitation")}</a>
      </div>
    </>
  );
}
