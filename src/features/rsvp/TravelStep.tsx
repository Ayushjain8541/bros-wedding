"use client";
import { useFormContext } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Field, FieldError, type FormValues } from "./form-fields";
import styles from "./RsvpForm.module.css";
export const windowKeys = {
  "before-noon": "beforeNoon",
  "noon-5pm": "noon5pm",
  "5-9pm": "5to9pm",
  "after-9pm": "after9pm",
} as const;
export function TravelStep() {
  const t = useTranslations("Rsvp");
  const { register, getFieldState, formState } = useFormContext<FormValues>();
  return (
    <>
      <h2>{t("travelTitle")}</h2>
      <p>{t("accommodation")}</p>
      {(["arrival", "departure"] as const).map((kind) => (
        <div className={styles.pair} key={kind}>
          <Field
            name={`travel.${kind}Date`}
            label={t(`${kind}Date`)}
            type="date"
            required
          />
          <div className={styles.field}>
            <label htmlFor={`travel.${kind}Window`}>{t(`${kind}Window`)}</label>
            <select
              id={`travel.${kind}Window`}
              {...register(`travel.${kind}Window`)}
              required
              aria-invalid={
                !!getFieldState(`travel.${kind}Window`, formState).error
              }
              aria-describedby={`travel.${kind}Window-error`}
            >
              <option value="">{t("chooseTime")}</option>
              {Object.entries(windowKeys).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
            <FieldError name={`travel.${kind}Window`} />
          </div>
        </div>
      ))}
      <fieldset className={styles.song}>
        <legend>{t("songPrompt")}</legend>
        <p>{t("optional")}</p>
        <Field name="song.name" label={t("songName")} />
        <Field name="song.artist" label={t("songArtist")} />
        <Field name="song.url" label={t("songUrl")} type="url" />
      </fieldset>
      <Field name="questions" label={t("questions")} textarea />
    </>
  );
}
