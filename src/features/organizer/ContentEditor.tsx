"use client";
import { useRef, useState } from "react";
import type {
  ContentSnapshot,
  WeddingSeed,
  Locale,
} from "@/features/wedding/types";
import en from "@/i18n/messages/en.json";
import hi from "@/i18n/messages/hi.json";
import styles from "./ContentEditor.module.css";
const locales = ["en", "hi"] as const;
const ist = (stamp: string) =>
  new Date(Date.parse(stamp) + 330 * 60000).toISOString().slice(0, 16);
const utc = (local: string) =>
  local ? new Date(`${local}:00+05:30`).toISOString() : "";
function Pair({
  label,
  value,
  onChange,
  long = false,
}: {
  label: string;
  value: Record<Locale, string>;
  onChange: (value: Record<Locale, string>) => void;
  long?: boolean;
}) {
  return (
    <div className={styles.pair}>
      {locales.map((locale) => (
        <label key={locale}>
          {label} · {locale === "en" ? "English" : "Hindi"}
          {long ? (
            <textarea
              lang={locale}
              value={value[locale]}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            />
          ) : (
            <input
              lang={locale}
              value={value[locale]}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            />
          )}
        </label>
      ))}
    </div>
  );
}
export function ContentEditor({ initial }: { initial: WeddingSeed }) {
  const [state, setState] = useState(initial),
    [base, setBase] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [storyConfirm, setStoryConfirm] = useState(false),
    [deadlineConfirm, setDeadlineConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null),
    [alt, setAlt] = useState({ en: "", hi: "" }),
    [provenance, setProvenance] = useState(""),
    [replace, setReplace] = useState("");
  const dirty = JSON.stringify(state) !== JSON.stringify(base);
  const changeContent = (patch: Partial<ContentSnapshot>) =>
    setState((s) => ({ ...s, content: { ...s.content, ...patch } }));
  const storyChanged = state.content.story.en !== base.content.story.en;
  const deadlineChanged =
    state.settings.newRsvpClosesAt !== base.settings.newRsvpClosesAt;
  const eventChanged = state.events.some(
    (e, i) =>
      e.startAt !== base.events[i].startAt ||
      e.endAt !== base.events[i].endAt ||
      e.cancelled !== base.events[i].cancelled,
  );
  const editEvent = (
    index: number,
    patch: Partial<WeddingSeed["events"][number]>,
  ) =>
    setState((s) => ({
      ...s,
      events: s.events.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    }));
  async function reload() {
    const response = await fetch("/api/admin/content", { cache: "no-store" });
    if (!response.ok) throw Error("Could not reload the published invitation.");
    const fresh = await response.json();
    setState(fresh);
    setBase(fresh);
    setStoryConfirm(false);
    setDeadlineConfirm(false);
    return fresh;
  }
  async function publish() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...state,
          expectedRevision: base.content.revision,
          confirmEnglishStoryChange: storyConfirm,
          confirmDeadlineChange: deadlineConfirm,
        }),
      });
      if (!response.ok) {
        const problem = await response.json();
        throw Error(
          response.status === 409
            ? "Someone published a newer revision. Reload the published version before editing again."
            : `Could not publish. Check ${Object.keys(problem.fieldErrors ?? {}).join(", ") || "your session and fields"}, then try again.`,
        );
      }
      const saved = await response.json();
      const next = {
        ...state,
        content: { ...state.content, revision: saved.revision },
      };
      setState(next);
      setBase(next);
      setStoryConfirm(false);
      setDeadlineConfirm(false);
      setMessage(
        `Published revision ${saved.revision}. Guest pages will show it on reload.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not publish. Reload to check the published revision before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = new FormData();
      data.set("photo", file);
      data.set("alt", JSON.stringify(alt));
      data.set("provenance", provenance);
      data.set("expectedRevision", String(base.content.revision));
      if (replace) data.set("replacePhotoId", replace);
      const response = await fetch("/api/admin/photos", {
        method: "POST",
        body: data,
      });
      if (!response.ok)
        throw Error(
          response.status === 409
            ? "A newer revision was published. Reload before uploading again."
            : "Photo could not be published. Use a JPEG, PNG or WebP up to 10 MiB, with both descriptions and its source.",
        );
      const photo = await response.json();
      const photos = replace
        ? state.content.photos.map((p) => (p.id === replace ? photo : p))
        : [...state.content.photos, photo];
      const cleanPhotos = photos.map(
        ({ id, storagePath, alt, position, provenance }) => ({
          id,
          storagePath,
          alt,
          position,
          provenance,
        }),
      );
      const next = {
        ...state,
        content: {
          ...state.content,
          photos: cleanPhotos,
          revision: photo.revision,
        },
      };
      setState(next);
      setBase(next);
      setReplace("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setAlt({ en: "", hi: "" });
      setProvenance("");
      setMessage(`Photo published in revision ${photo.revision}.`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Photo upload failed. Reload before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.editor}>
      <h2>Invitation content</h2>
      <p>
        Edit English and Hindi together. Published revision{" "}
        {base.content.revision}.
      </p>
      <p className={styles.notice}>
        Save the whole invitation when you are ready. Dates and invitation
        groups stay fixed. Photo uploads publish separately after you save any
        text changes.
      </p>
      {error && (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void publish();
        }}
      >
        <fieldset disabled={busy}>
          <details open>
            <summary>Names, welcome & families</summary>
            {(["displayName", "brideName", "groomName"] as const).map((key) => (
              <Pair
                key={key}
                label={
                  {
                    displayName: "Display names",
                    brideName: "Bride name",
                    groomName: "Groom name",
                  }[key]
                }
                value={state.content.couple[key]}
                onChange={(v) =>
                  changeContent({
                    couple: { ...state.content.couple, [key]: v },
                  })
                }
              />
            ))}
            <Pair
              label="Welcome"
              value={state.content.welcome}
              long
              onChange={(welcome) => changeContent({ welcome })}
            />
            <Pair
              label="Families"
              value={state.content.families}
              long
              onChange={(families) => changeContent({ families })}
            />
          </details>
          <details>
            <summary>Our story & copy approvals</summary>
            <Pair
              label="Our story"
              value={state.content.story}
              long
              onChange={(story) => {
                changeContent({ story });
                setStoryConfirm(false);
              }}
            />
            {storyChanged && (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={storyConfirm}
                  onChange={(e) => setStoryConfirm(e.target.checked)}
                />
                I confirm this change to the approved English story.
              </label>
            )}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={state.content.hindiApproved}
                onChange={(e) =>
                  changeContent({ hindiApproved: e.target.checked })
                }
              />
              Family has approved the Hindi copy
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={state.content.ceremonyCopyApproved}
                onChange={(e) =>
                  changeContent({ ceremonyCopyApproved: e.target.checked })
                }
              />
              Family has approved ceremony explanations for guest pages
            </label>
            <p>
              Unapproved ceremony explanations remain hidden. Hindi drafts are
              marked as awaiting approval.
            </p>
          </details>
          <details>
            <summary>Celebrations & times</summary>
            <p>
              All times use India Standard Time (IST). Keep each event on its
              existing date and in schedule order.
            </p>
            {state.events.map((event, index) => (
              <details key={event.id}>
                <summary>{event.title.en}</summary>
                <Pair
                  label={`${event.id} title`}
                  value={event.title}
                  onChange={(title) => editEvent(index, { title })}
                />
                <div className={styles.pair}>
                  <label>
                    {event.id} start (IST)
                    <input
                      type="datetime-local"
                      value={ist(event.startAt)}
                      onChange={(e) => {
                        if (e.target.value)
                          editEvent(index, { startAt: utc(e.target.value) });
                      }}
                    />
                  </label>
                  <label>
                    {event.id} end (IST; blank means onwards)
                    <input
                      type="datetime-local"
                      value={event.endAt ? ist(event.endAt) : ""}
                      onChange={(e) =>
                        editEvent(index, {
                          endAt: e.target.value ? utc(e.target.value) : null,
                        })
                      }
                    />
                  </label>
                </div>
                <Pair
                  label={`${event.id} dress code`}
                  value={event.dressCode ?? { en: "", hi: "" }}
                  onChange={(dressCode) =>
                    editEvent(index, {
                      dressCode:
                        dressCode.en || dressCode.hi ? dressCode : null,
                    })
                  }
                />
                <Pair
                  label={`${event.id} location`}
                  value={event.venueSublocation ?? { en: "", hi: "" }}
                  onChange={(venueSublocation) =>
                    editEvent(index, {
                      venueSublocation:
                        venueSublocation.en || venueSublocation.hi
                          ? venueSublocation
                          : null,
                    })
                  }
                />
                <Pair
                  label={`${event.id} explanation`}
                  value={event.description}
                  long
                  onChange={(description) => editEvent(index, { description })}
                />
                <label>
                  {event.id} map URL
                  <input
                    type="url"
                    value={event.mapUrl}
                    onChange={(e) =>
                      editEvent(index, { mapUrl: e.target.value })
                    }
                  />
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={event.cancelled}
                    onChange={(e) =>
                      editEvent(index, { cancelled: e.target.checked })
                    }
                  />
                  Mark {event.title.en} cancelled
                </label>
                <p>
                  Visible to {event.eligibleGroups.join(" and ")}. Existing
                  selections are retained in response history.
                </p>
              </details>
            ))}
          </details>
          <details>
            <summary>Venue, help & response deadline</summary>
            <p>
              Wedding dates: {state.content.wedding.startDate} –{" "}
              {state.content.wedding.endDate}
            </p>
            <Pair
              label="Venue name"
              value={state.content.wedding.venueName}
              onChange={(venueName) =>
                changeContent({
                  wedding: { ...state.content.wedding, venueName },
                })
              }
            />
            <Pair
              label="Venue address"
              value={state.content.wedding.address}
              onChange={(address) =>
                changeContent({
                  wedding: { ...state.content.wedding, address },
                })
              }
            />
            <label>
              Venue map URL
              <input
                type="url"
                value={state.content.wedding.mapUrl}
                onChange={(e) =>
                  changeContent({
                    wedding: {
                      ...state.content.wedding,
                      mapUrl: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              Help phone, including country code
              <input
                type="tel"
                value={state.settings.helpPhone}
                onChange={(e) => {
                  const phone = e.target.value;
                  setState((s) => ({
                    ...s,
                    settings: {
                      ...s.settings,
                      helpPhone: phone,
                      helpTelUrl: `tel:${phone.replaceAll(" ", "")}`,
                      helpWhatsAppUrl: `https://wa.me/${phone.replaceAll(" ", "").replace(/^\+/, "")}`,
                    },
                  }));
                }}
              />
            </label>
            <p>
              Call and WhatsApp links regenerate from this number on publish.
            </p>
            <label>
              New response cutoff (IST)
              <input
                type="datetime-local"
                value={ist(state.settings.newRsvpClosesAt)}
                onChange={(e) => {
                  if (e.target.value)
                    setState((s) => ({
                      ...s,
                      settings: {
                        ...s.settings,
                        newRsvpClosesAt: utc(e.target.value),
                      },
                    }));
                  setDeadlineConfirm(false);
                }}
              />
            </label>
            <p>
              Closes at {ist(state.settings.newRsvpClosesAt).replace("T", " ")}{" "}
              IST. Existing secure edits remain available.
            </p>
            {deadlineChanged && (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={deadlineConfirm}
                  onChange={(e) => setDeadlineConfirm(e.target.checked)}
                />
                I confirm the new response cutoff shown in IST.
              </label>
            )}
            <label>
              Maximum guests per party
              <input
                type="number"
                min={1}
                max={200}
                value={state.settings.maxPartySize}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    settings: {
                      ...s.settings,
                      maxPartySize: Number(e.target.value),
                    },
                  }))
                }
              />
            </label>
          </details>
          <details>
            <summary>Invitation labels</summary>
            <p>Leave a label blank to use its standard translation.</p>
            {Object.keys(en.Invitation).map((key) => (
              <div key={key} className={styles.pair}>
                {locales.map((locale) => (
                  <label key={locale}>
                    {key} · {locale === "en" ? "English" : "Hindi"}
                    <input
                      lang={locale}
                      placeholder={
                        (locale === "en" ? en : hi).Invitation[
                          key as keyof typeof en.Invitation
                        ]
                      }
                      value={state.content.labels[locale][key] ?? ""}
                      onChange={(e) => {
                        const labels = structuredClone(state.content.labels);
                        if (e.target.value)
                          labels[locale][key] = e.target.value;
                        else delete labels[locale][key];
                        changeContent({ labels });
                      }}
                    />
                  </label>
                ))}
              </div>
            ))}
          </details>
          <details>
            <summary>Published photo descriptions & order</summary>
            <p>
              Removing a photo takes effect when you publish. Its file is
              removed after the new snapshot is saved.
            </p>
            {state.content.photos.map((photo, index) => (
              <div key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.photo}
                  src={`/api/photos/${photo.id}`}
                  alt={photo.alt.en}
                  width={180}
                  height={135}
                  loading="lazy"
                />
                <Pair
                  label={`Photo ${index + 1} description`}
                  value={photo.alt}
                  onChange={(alt) =>
                    changeContent({
                      photos: state.content.photos.map((p) =>
                        p.id === photo.id ? { ...p, alt } : p,
                      ),
                    })
                  }
                />
                <label>
                  Photo {index + 1} source / permission
                  <input
                    value={photo.provenance}
                    onChange={(e) =>
                      changeContent({
                        photos: state.content.photos.map((p) =>
                          p.id === photo.id
                            ? { ...p, provenance: e.target.value }
                            : p,
                        ),
                      })
                    }
                  />
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      const photos = [...state.content.photos];
                      [photos[index - 1], photos[index]] = [
                        photos[index],
                        photos[index - 1],
                      ];
                      changeContent({
                        photos: photos.map((p, i) => ({ ...p, position: i })),
                      });
                    }}
                  >
                    Move photo {index + 1} earlier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      changeContent({
                        photos: state.content.photos
                          .filter((p) => p.id !== photo.id)
                          .map((p, i) => ({ ...p, position: i })),
                      })
                    }
                  >
                    Remove photo {index + 1}
                  </button>
                </div>
              </div>
            ))}
          </details>
          {eventChanged && (
            <p role="note" className={styles.notice}>
              Changed times or cancellations affect guests who already replied.
              Their recorded selections will stay in history; contact affected
              parties separately.
            </p>
          )}
          <div className={styles.actions}>
            <button
              disabled={
                !dirty ||
                (storyChanged && !storyConfirm) ||
                (deadlineChanged && !deadlineConfirm)
              }
            >
              {busy ? "Publishing…" : "Publish invitation"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                void reload()
                  .then(() => setMessage("Published version reloaded."))
                  .catch((e) => setError(e.message));
              }}
            >
              Reload published version (discard edits)
            </button>
          </div>
        </fieldset>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <fieldset disabled={busy || dirty}>
          <h3>Add or replace a photo</h3>
          <p>
            JPEG, PNG or WebP, up to 10 MiB. Include a useful description in
            both languages and record the source or permission.
          </p>
          {dirty && (
            <p>Publish your invitation edits before uploading a photo.</p>
          )}
          <label>
            Photo file
            <input
              type="file"
              ref={fileInput}
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </label>
          <Pair label="New photo description" value={alt} onChange={setAlt} />
          <label>
            New photo source / permission
            <input
              required
              value={provenance}
              onChange={(e) => setProvenance(e.target.value)}
            />
          </label>
          <label>
            Photo placement
            <select
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
            >
              <option value="">Add at end</option>
              {state.content.photos.map((p, i) => (
                <option key={p.id} value={p.id}>
                  Replace photo {i + 1}: {p.alt.en}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              !file || !alt.en.trim() || !alt.hi.trim() || !provenance.trim()
            }
          >
            Publish photo
          </button>
        </fieldset>
      </form>
    </section>
  );
}
