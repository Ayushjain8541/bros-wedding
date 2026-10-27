"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import type {
  CreateCommand,
  EditCommand,
  Locale,
  PartySnapshot,
  RsvpInput,
  SaveResult,
  SiteSettings,
  WeddingEvent,
} from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import { validateRsvp, isNewRsvpOpen } from "./validation";
import {
  createResponse,
  editResponse,
  errorMessageKey,
  exchangeEditToken,
  newCreateCommand,
  readCurrentResponse,
} from "./client";
import { fieldPath, toForm, toInput, type FormValues } from "./form-fields";
import { ContactStep } from "./ContactStep";
import { GuestsStep } from "./GuestsStep";
import { EventsStep } from "./EventsStep";
import { TravelStep } from "./TravelStep";
import { ReviewStep } from "./ReviewStep";
import { SavedResponse, SecureEditLink } from "./SavedResponse";
import { RsvpShell } from "./RsvpShell";
import styles from "./RsvpForm.module.css";
type Props = {
  events: WeddingEvent[];
  settings: SiteSettings;
  locale: Locale;
  initial?: PartySnapshot;
};
type Attempt =
  | { kind: "create"; command: CreateCommand }
  | { kind: "edit"; command: EditCommand };
const pathStep = (path: string) =>
  path.startsWith("contact") || path === "note" || path === "decision"
    ? 0
    : path.startsWith("guest")
      ? 1
      : path.startsWith("event")
        ? 2
        : 3;
export function RsvpForm(props: Props) {
  return (
    <RsvpShell locale={props.locale} settings={props.settings}>
      {(locale) => <RsvpEditor {...props} locale={locale} />}
    </RsvpShell>
  );
}
export function RsvpEditor({ events, settings, locale, initial }: Props) {
  const t = useTranslations("Rsvp");
  const common = useTranslations("Common");
  const errors = useTranslations("Errors");
  const methods = useForm<FormValues>({
    defaultValues: toForm(initial?.response),
    shouldUnregister: false,
  });
  const {
    getValues,
    setError,
    clearErrors,
    setFocus,
    reset,
    unregister,
    setValue,
    formState: { isDirty },
  } = methods;
  const decision = useWatch({ control: methods.control, name: "decision" });
  const [step, setStep] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{ path: string }>();
  const [editing, setEditing] = useState(initial);
  const [review, setReview] = useState<RsvpInput>();
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [securePath, setSecurePath] = useState<string>();
  const [committed, setCommitted] = useState<SaveResult>();
  const [saved, setSaved] = useState<PartySnapshot>();
  const [summaryFailed, setSummaryFailed] = useState(false);
  const attempt = useRef<Attempt | undefined>(undefined);
  const busy = useRef(false);
  const confirmedSession = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [closed, setClosed] = useState(
    () => !initial && !isNewRsvpOpen(new Date(), settings.newRsvpClosesAt),
  );
  useEffect(() => {
    if (editing) return;
    const tick = () =>
      setClosed(!isNewRsvpOpen(new Date(), settings.newRsvpClosesAt));
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [editing, settings.newRsvpClosesAt]);
  useEffect(() => {
    if ((!isDirty && !uncertain) || committed) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, uncertain, committed]);
  useEffect(() => {
    if (saved)
      document.querySelector<HTMLElement>("[data-result-heading]")?.focus();
  }, [saved]);
  useLayoutEffect(() => {
    const element = focusTarget
      ? formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      : formRef.current?.querySelector<HTMLElement>("h2");
    if (element) {
      element.setAttribute(
        "tabindex",
        element.tagName === "H2"
          ? "-1"
          : (element.getAttribute("tabindex") ?? "0"),
      );
      element.focus();
      element.scrollIntoView({ block: "nearest" });
    } else if (focusTarget) setFocus(fieldPath(focusTarget.path));
  }, [step, focusTarget, setFocus]);
  function move(next: number) {
    setFocusTarget(undefined);
    setStep(next);
  }
  function showFields(
    fieldErrors: Record<string, string[]>,
    targetStep?: number,
  ) {
    const entries = Object.entries(fieldErrors).filter(
      ([path]) => targetStep === undefined || pathStep(path) === targetStep,
    );
    for (const [path, codes] of entries) {
      const mapped = path.startsWith("eventIds.")
        ? "eventIds"
        : fieldPath(path);
      setError(mapped as ReturnType<typeof fieldPath>, {
        type: "domain",
        message: codes[0],
      });
    }
    if (entries.length) {
      if (targetStep === undefined) setStep(pathStep(entries[0][0]));
      setFocusTarget({ path: entries[0][0] });
    }
    return entries.length;
  }
  function validateStep() {
    clearErrors();
    setFailure(undefined);
    const input = toInput(getValues());
    try {
      return validateRsvp(
        input,
        events.filter((event) => !event.cancelled).map((event) => event.id),
        settings.maxPartySize,
      );
    } catch (error) {
      if (error instanceof DomainError && error.fieldErrors) {
        const count = showFields(
          error.fieldErrors,
          step === 4 ? undefined : step,
        );
        if (count) return;
      } else throw error;
    }
    return input;
  }
  function next() {
    const response = validateStep();
    if (!response) return;
    if (step === 3 || decision === "decline") {
      setReview(response);
      move(4);
    } else move(step + 1);
  }
  function changeDecision(nextDecision: "accept" | "decline") {
    clearErrors();
    if (nextDecision === "decline")
      unregister(["guests", "eventIds", "travel", "song", "questions"]);
    else {
      unregister("note");
      const blank = toForm();
      setValue("guests", blank.guests);
      setValue("eventIds", []);
      setValue("travel", blank.travel);
      setValue("song", blank.song);
      setValue("questions", "");
    }
  }
  async function loadSummary(result: SaveResult) {
    setSummaryFailed(false);
    try {
      if (attempt.current?.kind === "create" && !confirmedSession.current) {
        await exchangeEditToken(attempt.current.command.editToken);
        confirmedSession.current = true;
      }
      const snapshot = await readCurrentResponse();
      if (snapshot.id !== result.id) throw new DomainError("conflict", 409);
      setSaved(snapshot);
      setCommitted(result);
    } catch {
      setSummaryFailed(true);
    }
  }
  async function submit() {
    if (busy.current) return;
    if (!attempt.current) {
      const response = validateStep();
      if (!response) return;
      attempt.current = editing
        ? {
            kind: "edit",
            command: {
              expectedSubmissionId: editing.id,
              expectedVersion: editing.version,
              response: structuredClone(response),
            },
          }
        : { kind: "create", command: newCreateCommand(response) };
    }
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      const current = attempt.current;
      const result =
        current.kind === "create"
          ? await createResponse(current.command)
          : await editResponse(current.command);
      setCommitted(result);
      if (current.kind === "create")
        setSecurePath(
          result.editPath ?? `/rsvp/edit#${current.command.editToken}`,
        );
      setUncertain(false);
      await loadSummary(result);
    } catch (error) {
      const failure =
        error instanceof DomainError
          ? error
          : new DomainError("NETWORK_ERROR", 0);
      setFailure(failure.code);
      // A later rejection cannot prove an earlier lost request did not commit.
      const unknown =
        uncertain || failure.status === 0 || failure.status >= 500;
      setUncertain(unknown);
      if (!unknown) {
        attempt.current = undefined;
        if (failure.fieldErrors) showFields(failure.fieldErrors);
        if (failure.code === "closed") setClosed(true);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function reloadCurrent() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      const snapshot = await readCurrentResponse();
      if (editing && snapshot.id !== editing.id)
        throw new DomainError("ACCESS_DENIED", 401);
      setEditing(snapshot);
      reset(toForm(snapshot.response));
      attempt.current = undefined;
      setUncertain(false);
      move(0);
    } catch (error) {
      setFailure(error instanceof DomainError ? error.code : "UNAVAILABLE");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const editPath = securePath;
  if (saved)
    return (
      <SavedResponse
        snapshot={saved}
        editPath={editPath}
        duplicateWarning={committed?.duplicateWarning}
        events={events}
        locale={locale}
        onEdit={() => {
          setEditing(saved);
          reset(toForm(saved.response));
          setSaved(undefined);
          setCommitted(undefined);
          attempt.current = undefined;
          setReview(undefined);
          move(0);
        }}
      />
    );
  if (committed)
    return (
      <section aria-live="polite">
        <h2>{t("saved")}</h2>
        <p>{t(summaryFailed ? "summaryUnavailable" : "loadingSummary")}</p>
        {summaryFailed && (
          <button
            disabled={pending}
            type="button"
            onClick={async () => {
              setPending(true);
              await loadSummary(committed);
              setPending(false);
            }}
          >
            {common("retry")}
          </button>
        )}
        {editPath && <SecureEditLink editPath={editPath} />}
      </section>
    );
  if (closed && !editing && !uncertain && !pending)
    return (
      <section>
        <h2>{t("deadlineClosed")}</h2>
        <p>{t("closedHelp")}</p>
      </section>
    );
  return (
    <FormProvider {...methods}>
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step === 4) void submit();
          else next();
        }}
      >
        <p className={styles.progress}>
          {t("step", {
            current: decision === "decline" ? (step === 4 ? 2 : 1) : step + 1,
            total: decision === "decline" ? 2 : 5,
          })}
        </p>
        {failure && (
          <div role="alert" className={styles.error}>
            <p>{errors(errorMessageKey(failure))}</p>
            {(failure === "ACCESS_DENIED" || failure === "forbidden") && (
              <p>{t("reopenInstructions")}</p>
            )}
            {failure === "conflict" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void reloadCurrent()}
              >
                {t("reloadResponse")}
              </button>
            )}
          </div>
        )}
        <fieldset disabled={pending || uncertain} className={styles.step}>
          {step === 0 && <ContactStep onDecision={changeDecision} />}
          {step === 1 && <GuestsStep maxPartySize={settings.maxPartySize} />}
          {step === 2 && <EventsStep events={events} locale={locale} />}
          {step === 3 && <TravelStep />}
          {step === 4 && review && (
            <ReviewStep response={review} events={events} locale={locale} />
          )}
        </fieldset>
        <div className={styles.actions}>
          {step > 0 && !uncertain && (
            <button
              className={styles.secondary}
              type="button"
              disabled={pending}
              onClick={() => {
                clearErrors();
                setFailure(undefined);
                move(step === 4 && decision === "decline" ? 0 : step - 1);
              }}
            >
              {common("back")}
            </button>
          )}
          <button type="submit" disabled={pending || failure === "conflict"}>
            {pending
              ? t("saving")
              : uncertain
                ? t("retrySame")
                : step === 4
                  ? t(editing ? "saveChanges" : "submit")
                  : common("next")}
          </button>
        </div>
      </form>
    </FormProvider>
  );
}
