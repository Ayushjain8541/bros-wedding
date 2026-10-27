"use client";
import type { InputHTMLAttributes } from "react";
import { useFormContext, type FieldPath } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { EventId, RsvpInput, Travel } from "@/features/wedding/types";
import { errorMessageKey } from "./client";
import styles from "./RsvpForm.module.css";
export type FormValues = {
  decision: "accept" | "decline";
  contact: { fullName: string; whatsapp: string };
  guests: { name: string }[];
  eventIds: EventId[];
  travel: Travel;
  song: { name: string; artist: string; url: string };
  questions: string;
  note: string;
};
export function toForm(response?: RsvpInput): FormValues {
  const accept = response?.decision === "accept" ? response : undefined;
  return {
    decision: response?.decision ?? "accept",
    contact: response?.contact ?? { fullName: "", whatsapp: "" },
    guests: accept?.guestNames.map((name) => ({ name })) ?? [{ name: "" }],
    eventIds: accept?.eventIds ?? [],
    travel: accept?.travel ?? {
      arrivalDate: "",
      arrivalWindow: "" as Travel["arrivalWindow"],
      departureDate: "",
      departureWindow: "" as Travel["departureWindow"],
    },
    song: {
      name: accept?.song?.name ?? "",
      artist: accept?.song?.artist ?? "",
      url: accept?.song?.url ?? "",
    },
    questions: accept?.questions ?? "",
    note: response?.decision === "decline" ? (response.note ?? "") : "",
  };
}
export function toInput(values: FormValues): RsvpInput {
  if (values.decision === "decline")
    return {
      decision: "decline",
      contact: values.contact,
      ...(values.note ? { note: values.note } : {}),
    };
  const song = values.song;
  return {
    decision: "accept",
    contact: values.contact,
    guestNames: (values.guests ?? []).map((guest) => guest.name),
    eventIds: values.eventIds ?? [],
    travel: values.travel,
    ...(song && (song.name.trim() || song.artist.trim() || song.url.trim())
      ? {
          song: {
            name: song.name,
            artist: song.artist,
            ...(song.url.trim() ? { url: song.url.trim() } : {}),
          },
        }
      : {}),
    ...(values.questions ? { questions: values.questions } : {}),
  };
}
export function fieldPath(path: string): FieldPath<FormValues> {
  return path
    .replace(/^guestNames\.(\d+)$/, "guests.$1.name")
    .replace(/^guestNames$/, "guests") as FieldPath<FormValues>;
}
export function FieldError({ name }: { name: FieldPath<FormValues> }) {
  const { getFieldState, formState } = useFormContext<FormValues>();
  const t = useTranslations("Errors");
  const error = getFieldState(name, formState).error;
  return error ? (
    <p className={styles.fieldError} id={`${name}-error`}>
      {t(errorMessageKey(error.message ?? "required"))}
    </p>
  ) : null;
}
export function Field({
  name,
  label,
  textarea = false,
  ...props
}: {
  name: FieldPath<FormValues>;
  label: string;
  textarea?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  const { register, getFieldState, formState } = useFormContext<FormValues>();
  const invalid = !!getFieldState(name, formState).error;
  return (
    <div className={styles.field}>
      <label htmlFor={name}>{label}</label>
      {textarea ? (
        <textarea
          id={name}
          {...register(name)}
          rows={4}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${name}-error` : undefined}
        />
      ) : (
        <input
          id={name}
          {...props}
          {...register(name)}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${name}-error` : undefined}
        />
      )}
      <FieldError name={name} />
    </div>
  );
}
