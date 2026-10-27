"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WeddingEvent } from "@/features/wedding/types";
import type { DashboardMetrics } from "./metrics";
import styles from "./Admin.module.css";
const windows = {
  "before-noon": "Before noon",
  "noon-5pm": "Noon–5 pm",
  "5-9pm": "5–9 pm",
  "after-9pm": "After 9 pm",
};
export function Dashboard({ events }: { events: WeddingEvent[] }) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    return fetch("/api/admin/metrics", {
      cache: "no-store",
      signal: request.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Metrics unavailable");
        return response.json() as Promise<DashboardMetrics>;
      })
      .then((data) => {
        if (!request.signal.aborted) setMetrics(data);
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
  }, []);
  const refresh = useCallback(() => {
    setLoading(true);
    setError(false);
    setMetrics(null);
    void load();
  }, [load]);
  useEffect(() => {
    void load();
    // Returning from an edit or another window must read current persisted replies.
    const update = () => void refresh();
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    return () => {
      controller.current?.abort();
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
    };
  }, [load, refresh]);
  return (
    <section aria-labelledby="attendance-heading" aria-busy={loading}>
      <h2 id="attendance-heading">Attendance & stays</h2>
      <p>
        All received replies across both invitation groups. Counts are
        individual guests.
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          Refresh totals
        </button>
        <a href="/api/admin/exports/guests" download="wedding-guests.csv">
          Export guest CSV
        </a>
        <a href="/api/admin/exports/parties" download="wedding-parties.csv">
          Export party CSV
        </a>
      </div>
      {loading && <p>Loading current totals…</p>}
      {error && (
        <p role="alert" className={styles.alert}>
          Could not load current totals. Refresh totals to try again.
        </p>
      )}
      {metrics && (
        <>
          <dl>
            <dt>Accepting submissions</dt>
            <dd>{metrics.acceptingSubmissions}</dd>
            <dt>Declining submissions</dt>
            <dd>{metrics.decliningSubmissions}</dd>
            <dt>Attending guests</dt>
            <dd data-testid="attending-guests">{metrics.attendingGuests}</dd>
            <dt>Guest-nights</dt>
            <dd data-testid="guest-nights">{metrics.guestNights}</dd>
          </dl>
          <p>
            Guests staying overnight count from arrival up to, and excluding,
            departure. These are guest counts, not room requirements.
          </p>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption>Replies by invitation group</caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Accepting submissions</th>
                  <th scope="col">Declining submissions</th>
                  <th scope="col">Attending guests</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.groups).map(([id, g]) => (
                  <tr key={id}>
                    <th scope="row">
                      {id === "group-1" ? "Group 1" : "Group 2"}
                    </th>
                    <td>{g.acceptingSubmissions}</td>
                    <td>{g.decliningSubmissions}</td>
                    <td>{g.attendingGuests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption>Guests by selected event</caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Guests</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.eventGuests).map(([id, count]) => {
                  const event = events.find((e) => e.id === id);
                  return (
                    <tr key={id}>
                      <th scope="row">
                        {event?.title.en ?? id}
                        {event?.cancelled && (
                          <>
                            {" "}
                            <span className={styles.badge}>Cancelled</span>
                          </>
                        )}
                      </th>
                      <td>{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption>Guests staying overnight</caption>
              <thead>
                <tr>
                  <th scope="col">Night beginning</th>
                  <th scope="col">Guests</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.nightlyGuests)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, count]) => (
                    <tr key={date}>
                      <th scope="row">{date}</th>
                      <td>{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!Object.keys(metrics.nightlyGuests).length && (
            <p>No overnight stays reported.</p>
          )}
          {(["arrivals", "departures"] as const).map((kind) => (
            <div className={styles.scroll} key={kind}>
              <table className={styles.table}>
                <caption>
                  {kind === "arrivals" ? "Arriving guests" : "Departing guests"}{" "}
                  · local travel dates and windows
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    {Object.values(windows).map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metrics[kind])
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, counts]) => (
                      <tr key={date}>
                        <th scope="row">{date}</th>
                        {Object.keys(windows).map((w) => (
                          <td key={w}>
                            {counts[w as keyof typeof windows] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          <h3>Possible duplicates</h3>
          <p>
            Primary contact matches are warnings for review. Replies remain
            separate and are counted individually.
          </p>
          {metrics.duplicates.length ? (
            <ul>
              {metrics.duplicates.map((group, i) => (
                <li key={i}>
                  {group.reason === "contact"
                    ? "Matching contact number"
                    : "Matching contact name"}
                  :{" "}
                  {group.submissionIds.map((id, index) => (
                    <span key={id}>
                      {index > 0 ? ", " : ""}
                      <Link href={`/admin/responses/${id}`}>
                        Review reply {id}
                      </Link>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p>No possible duplicates found.</p>
          )}
          <h3>Questions</h3>
          {metrics.questions.length ? (
            <ul>
              {metrics.questions.map((q) => (
                <li key={q.submissionId}>
                  <Link href={`/admin/responses/${q.submissionId}`}>
                    View reply
                  </Link>
                  : {q.text}
                </li>
              ))}
            </ul>
          ) : (
            <p>No questions received.</p>
          )}
          <h3>Song requests</h3>
          {metrics.songs.length ? (
            <ul>
              {metrics.songs.map((s) => (
                <li key={s.submissionId}>
                  <Link href={`/admin/responses/${s.submissionId}`}>
                    View reply
                  </Link>
                  : {s.song.name} — {s.song.artist}
                  {s.song.url && <> · {s.song.url}</>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No song requests received.</p>
          )}
        </>
      )}
    </section>
  );
}
