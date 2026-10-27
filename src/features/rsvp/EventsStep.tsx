"use client";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { Locale, WeddingEvent } from "@/features/wedding/types";
import { FieldError, type FormValues } from "./form-fields";
import styles from "./RsvpForm.module.css";
export function EventsStep({
  events,
  locale,
}: {
  events: WeddingEvent[];
  locale: Locale;
}) {
  const t = useTranslations("Rsvp");
  const { register, formState, control } = useFormContext<FormValues>();
  const selectedIds = useWatch({ control, name: "eventIds" }) ?? [];
  return (
    <>
      <h2>{t("eventSelection")}</h2>
      <p>{t("eventNote")}</p>
      <fieldset className={styles.choices}>
        <legend className={styles.srOnly}>{t("eventSelection")}</legend>
        {events.map((event) => (
          <label key={event.id}>
            <input
              type="checkbox"
              value={event.id}
              disabled={event.cancelled && !selectedIds.includes(event.id)}
              {...register("eventIds")}
              aria-invalid={!!formState.errors.eventIds}
              aria-describedby={
                formState.errors.eventIds ? "eventIds-error" : undefined
              }
            />
            <span>
              {event.title[locale]}
              {event.cancelled && ` — ${t("cancelled")}`}
              {event.cancelled && selectedIds.includes(event.id) && (
                <small>{t("removeCancelledEvent")}</small>
              )}
              <small>
                {new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-GB", {
                  day: "numeric",
                  month: "long",
                  timeZone: "Asia/Kolkata",
                }).format(new Date(event.startAt))}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <FieldError name="eventIds" />
    </>
  );
}
