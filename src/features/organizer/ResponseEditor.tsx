"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, FormProvider, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import type {
  GroupId,
  PartySnapshot,
  SiteSettings,
  WeddingEvent,
} from "@/features/wedding/types";
import { ContactStep } from "@/features/rsvp/ContactStep";
import { GuestsStep } from "@/features/rsvp/GuestsStep";
import { EventsStep } from "@/features/rsvp/EventsStep";
import { TravelStep } from "@/features/rsvp/TravelStep";
import {
  fieldPath,
  toForm,
  toInput,
  type FormValues,
} from "@/features/rsvp/form-fields";
import { newCreateCommand, errorMessageKey } from "@/features/rsvp/client";
import { DomainError } from "@/lib/errors";
import styles from "./Admin.module.css";
type ManualCreate = {
  groupId: GroupId;
  command: ReturnType<typeof newCreateCommand>;
  source: "phone" | "whatsapp";
  overrideReason?: string;
};
type CommittedSave = { id: string; created: boolean };
export function ResponseEditor({
  party,
  events,
  settings,
}: {
  party?: PartySnapshot;
  events: WeddingEvent[];
  settings: SiteSettings;
}) {
  const methods = useForm<FormValues>({
      defaultValues: toForm(party?.response),
    }),
    [current, setCurrent] = useState(party),
    [group, setGroup] = useState<GroupId>(party?.groupId ?? "group-1"),
    [source, setSource] = useState<"phone" | "whatsapp">("phone"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<DomainError | null>(null),
    [saved, setSaved] = useState(false),
    [pending, setPending] = useState<ManualCreate | null>(null),
    [uncertain, setUncertain] = useState(false),
    [committed, setCommitted] = useState<CommittedSave | null>(null);
  const router = useRouter();
  const t = useTranslations("Errors");
  const decision = useWatch({ control: methods.control, name: "decision" });
  async function load(id: string) {
    const result = await fetch(`/api/admin/responses/${id}`, {
      cache: "no-store",
    });
    if (!result.ok) throw new DomainError("UNAVAILABLE", result.status);
    return (await result.json()) as PartySnapshot;
  }
  async function confirmSaved(target: CommittedSave) {
    const latest = await load(target.id);
    if (latest.id !== target.id) throw new DomainError("UNAVAILABLE", 503);
    setCurrent(latest);
    setGroup(latest.groupId);
    methods.reset(toForm(latest.response));
    setPending(null);
    setUncertain(false);
    setCommitted(null);
    setSaved(true);
    if (target.created) router.replace(`/admin/responses/${latest.id}`);
  }
  async function reload() {
    setBusy(true);
    try {
      if (!current) return;
      const latest = await load(current.id);
      if (latest.id !== current.id) throw new DomainError("ACCESS_DENIED", 403);
      setCurrent(latest);
      methods.reset(toForm(latest.response));
      setError(null);
      setSaved(false);
    } catch (error) {
      setError(
        error instanceof DomainError
          ? error
          : new DomainError("UNAVAILABLE", 0),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.editor}>
      <h2>{current ? "Edit reply" : "Record a received reply"}</h2>
      {current && (
        <p>
          Source: <span className={styles.badge}>{current.source}</span> ·
          Revision {current.version}
        </p>
      )}
      <FormProvider {...methods}>
        <form
          onSubmit={methods.handleSubmit(async (values) => {
            setBusy(true);
            setError(null);
            setSaved(false);
            methods.clearErrors();
            // A later rejection cannot disprove an earlier possible commit.
            let mayHaveCommitted = uncertain || !!committed;
            try {
              if (committed) {
                await confirmSaved(committed);
                return;
              }
              const body = current
                ? {
                    expectedSubmissionId: current.id,
                    expectedVersion: current.version,
                    response: toInput(values),
                  }
                : (pending ?? {
                    groupId: group,
                    command: newCreateCommand(toInput(values)),
                    source,
                    ...(reason ? { overrideReason: reason } : {}),
                  });
              if (!current) setPending(body as ManualCreate);
              const result = await fetch(
                current
                  ? `/api/admin/responses/${current.id}`
                  : "/api/admin/responses",
                {
                  method: current ? "PATCH" : "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                },
              );
              const data = await result.json();
              if (!result.ok)
                throw new DomainError(data.code, result.status, data.fieldErrors);
              if (typeof data.id !== "string")
                throw new DomainError("UNAVAILABLE", 503);
              const target = { id: data.id, created: !current };
              mayHaveCommitted = true;
              setCommitted(target);
              await confirmSaved(target);
            } catch (error) {
              const problem =
                error instanceof DomainError
                  ? error
                  : new DomainError("NETWORK_ERROR", 0);
              setError(problem);
              if (!current) {
                if (mayHaveCommitted || problem.status < 400 || problem.status >= 500 || problem.status === 409)
                  setUncertain(true);
                else setPending(null);
              }
              for (const [name, codes] of Object.entries(
                problem.fieldErrors ?? {},
              ))
                methods.setError(
                  name === "_form" ? "root.server" : fieldPath(name),
                  { message: codes[0] },
                );
              const first = Object.keys(problem.fieldErrors ?? {}).find(
                (k) => k !== "_form",
              );
              if (first) methods.setFocus(fieldPath(first));
            } finally {
              setBusy(false);
            }
          })}
        >
          {!current && (
            <fieldset disabled={busy || !!pending || !!committed}>
              <legend>Received reply</legend>
              <label htmlFor="group">Invitation group</label>
              <select
                id="group"
                value={group}
                onChange={(e) => {
                  const nextGroup = e.target.value as GroupId;
                  setGroup(nextGroup);
                  const eligible = new Set(
                    events
                      .filter((event) =>
                        event.eligibleGroups.includes(nextGroup),
                      )
                      .map((event) => event.id),
                  );
                  methods.setValue(
                    "eventIds",
                    methods
                      .getValues("eventIds")
                      .filter((id) => eligible.has(id)),
                  );
                }}
              >
                <option value="group-1">Group 1</option>
                <option value="group-2">Group 2</option>
              </select>
              <label htmlFor="source">Received through</label>
              <select
                id="source"
                value={source}
                onChange={(e) =>
                  setSource(e.target.value as "phone" | "whatsapp")
                }
              >
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              <label htmlFor="reason">
                Deadline override reason (required after the deadline)
              </label>
              <textarea
                id="reason"
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </fieldset>
          )}
          <fieldset disabled={busy || !!pending || !!committed}>
            <legend>Response details</legend>
            <ContactStep onDecision={() => {}} />
            {decision === "accept" && (
              <>
                <GuestsStep maxPartySize={settings.maxPartySize} />
                <EventsStep
                  events={events.filter((e) =>
                    e.eligibleGroups.includes(group),
                  )}
                  locale="en"
                />
                <TravelStep />
              </>
            )}
          </fieldset>
          {error && (
            <div role="alert" className={styles.alert}>
              <p>{t(errorMessageKey(error.code))}</p>
              {error.status === 409 && current && !committed && (
                <button type="button" onClick={reload} disabled={busy}>
                  Reload latest response
                </button>
              )}
              {committed ? (
                <p>The reply was saved. Reload its details to continue.</p>
              ) : pending && (
                <p>
                  Retry uses the same received reply to avoid creating it twice.
                </p>
              )}
            </div>
          )}
          {saved && <p role="status">Response saved.</p>}
          <button disabled={busy || (error?.status === 409 && !committed)}>
            {busy
              ? "Saving…"
              : committed
                ? "Reload saved reply"
                : current
                ? "Save changes"
                : pending
                  ? "Retry received reply"
                  : "Save received reply"}
          </button>
        </form>
      </FormProvider>
    </section>
  );
}
