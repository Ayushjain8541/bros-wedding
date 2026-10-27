"use client";
import { useFormContext } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Field, type FormValues } from "./form-fields";
import styles from "./RsvpForm.module.css";
export function ContactStep({
  onDecision,
}: {
  onDecision: (decision: "accept" | "decline") => void;
}) {
  const t = useTranslations("Rsvp");
  const { register, watch } = useFormContext<FormValues>();
  return (
    <>
      <h2>{t("contactTitle")}</h2>
      <p>{t("contactNote")}</p>
      <Field
        name="contact.fullName"
        label={t("fullName")}
        autoComplete="name"
        required
      />
      <Field
        name="contact.whatsapp"
        label={t("whatsapp")}
        type="tel"
        autoComplete="tel"
        placeholder="+91…"
        required
      />
      <fieldset className={styles.choices}>
        <legend>{t("decision")}</legend>
        {(["accept", "decline"] as const).map((decision) => (
          <label key={decision}>
            <input
              type="radio"
              value={decision}
              {...register("decision", {
                onChange: () => onDecision(decision),
              })}
            />
            {t(decision)}
          </label>
        ))}
      </fieldset>
      {watch("decision") === "decline" && (
        <Field name="note" label={t("note")} textarea />
      )}
    </>
  );
}
