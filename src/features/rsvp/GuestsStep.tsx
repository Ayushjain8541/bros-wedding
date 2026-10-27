"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Field, FieldError, type FormValues } from "./form-fields";
import styles from "./RsvpForm.module.css";
export function GuestsStep({ maxPartySize }: { maxPartySize: number }) {
  const t = useTranslations("Rsvp");
  const { control, getValues, setValue } = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "guests" });
  return (
    <>
      <h2>{t("guestNames")}</h2>
      <p>{t("guestNote")}</p>
      <div className={styles.field}>
        <label htmlFor="party-size">{t("partySize")}</label>
        <select
          id="party-size"
          value={fields.length}
          onChange={(event) => {
            const size = Number(event.target.value);
            if (size < fields.length)
              remove(
                Array.from(
                  { length: fields.length - size },
                  (_, i) => size + i,
                ),
              );
            else
              append(
                Array.from({ length: size - fields.length }, () => ({
                  name: "",
                })),
              );
          }}
        >
          {Array.from({ length: Math.min(maxPartySize, 200) }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <FieldError name="guests" />
      </div>
      <button
        className={styles.secondary}
        type="button"
        onClick={() =>
          setValue("guests.0.name", getValues("contact.fullName"), {
            shouldDirty: true,
          })
        }
      >
        {t("copyContact")}
      </button>
      {fields.map((field, index) => (
        <Field
          key={field.id}
          name={`guests.${index}.name`}
          label={t("guestFullName", { number: index + 1 })}
          autoComplete="off"
          required
        />
      ))}
    </>
  );
}
