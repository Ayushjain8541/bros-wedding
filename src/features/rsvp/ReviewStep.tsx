"use client";
import { useTranslations } from "next-intl";
import type { Locale, RsvpInput, WeddingEvent } from "@/features/wedding/types";
import { windowKeys } from "./TravelStep";
import styles from "./RsvpForm.module.css";
export function ResponseSummary({
  response,
  events,
  locale,
}: {
  response: RsvpInput;
  events: WeddingEvent[];
  locale: Locale;
}) {
  const t = useTranslations("Rsvp");
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(new Date(`${value}T12:00:00+05:30`));
  return (
    <dl className={styles.summary}>
      <div>
        <dt>{t("decision")}</dt>
        <dd>{t(response.decision)}</dd>
      </div>
      <div>
        <dt>{t("fullName")}</dt>
        <dd>{response.contact.fullName}</dd>
      </div>
      <div>
        <dt>{t("whatsapp")}</dt>
        <dd dir="ltr">{response.contact.whatsapp}</dd>
      </div>
      {response.decision === "decline" ? (
        response.note && (
          <div>
            <dt>{t("note")}</dt>
            <dd>{response.note}</dd>
          </div>
        )
      ) : (
        <>
          <div>
            <dt>{t("guestNames")}</dt>
            <dd>
              <ul>
                {response.guestNames.map((name, index) => (
                  <li key={index}>{name}</li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>{t("eventSelection")}</dt>
            <dd>
              <ul>
                {response.eventIds.map((id) => (
                  <li key={id}>
                    {events.find((event) => event.id === id)?.title[locale] ??
                      t("unavailableEvent")}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>{t("arrivalDate")}</dt>
            <dd>
              {date(response.travel.arrivalDate)} ·{" "}
              {t(windowKeys[response.travel.arrivalWindow])}
            </dd>
          </div>
          <div>
            <dt>{t("departureDate")}</dt>
            <dd>
              {date(response.travel.departureDate)} ·{" "}
              {t(windowKeys[response.travel.departureWindow])}
            </dd>
          </div>
          {response.song && (
            <div>
              <dt>{t("songPrompt")}</dt>
              <dd>
                {response.song.name} — {response.song.artist}
                {response.song.url && (
                  <span className={styles.breakWord}>{response.song.url}</span>
                )}
              </dd>
            </div>
          )}
          {response.questions && (
            <div>
              <dt>{t("questions")}</dt>
              <dd>{response.questions}</dd>
            </div>
          )}
        </>
      )}
    </dl>
  );
}
export function ReviewStep(props: Parameters<typeof ResponseSummary>[0]) {
  const t = useTranslations("Rsvp");
  return (
    <>
      <h2>{t("review")}</h2>
      <p>{t("reviewNote")}</p>
      <ResponseSummary {...props} />
    </>
  );
}
