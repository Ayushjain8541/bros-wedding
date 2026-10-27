import { useTranslations } from "next-intl";
import type { Locale, WeddingEvent } from "@/features/wedding/types";
import styles from "./Invitation.module.css";
import { formatEventTime } from "@/features/wedding/time";
const zone = "Asia/Kolkata";
export function Celebrations({
  events,
  locale,
  ceremonyCopyApproved,
}: {
  events: WeddingEvent[];
  locale: Locale;
  ceremonyCopyApproved: boolean;
}) {
  const t = useTranslations("Invitation");
  const days = Map.groupBy(
    [...events].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    (event) =>
      new Date(Date.parse(event.startAt) + 330 * 60_000)
        .toISOString()
        .slice(0, 10),
  );
  const date = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
      ...options,
      timeZone: zone,
    })
      .format(new Date(value))
      .replace(/\s+/g, " ");
  const time = (value: string) =>
    formatEventTime(value, locale, { am: t("am"), pm: t("pm") });
  return (
    <section
      id="celebrations"
      className={`${styles.section} ${styles.celebrations}`}
      aria-labelledby="celebrations-title"
    >
      <h2 id="celebrations-title">{t("celebrations")}</h2>
      <p className={styles.sectionNote}>{t("celebrationsNote")}</p>
      <nav
        className={styles.dayNavigation}
        aria-label={t("chooseDay")}
        data-day-navigation
      >
        {[...days].map(([day, list]) => (
          <a key={day} href={`#day-${day}`}>
            <span>
              {date(list[0].startAt, { day: "numeric", month: "short" })}
            </span>
            <small>{date(list[0].startAt, { weekday: "long" })}</small>
          </a>
        ))}
      </nav>
      <p className={styles.timezone}>{t("timeZone")}</p>
      <div className={styles.schedule}>
        {[...days].map(([day, list]) => (
          <section
            key={day}
            id={`day-${day}`}
            className={styles.day}
            aria-labelledby={`date-${day}`}
          >
            <h3 id={`date-${day}`}>
              <span>{date(list[0].startAt, { day: "numeric" })}</span>
              {date(list[0].startAt, { month: "long" })}
              <small>{date(list[0].startAt, { weekday: "long" })}</small>
            </h3>
            <div className={styles.events}>
              {list.map((event) => (
                <article
                  key={event.id}
                  data-event-id={event.id}
                  className={styles.event}
                >
                  <div>
                    <h4>{event.title[locale]}</h4>
                    <p className={styles.eventTime}>
                      <time dateTime={event.startAt}>
                        {time(event.startAt)}
                      </time>
                      {event.endAt ? (
                        <>
                          {" "}
                          —{" "}
                          <time dateTime={event.endAt}>
                            {time(event.endAt)}
                          </time>
                        </>
                      ) : (
                        ` ${t("onwards")}`
                      )}
                    </p>
                  </div>
                  {event.cancelled && <p>{t("cancelled")}</p>}
                  {ceremonyCopyApproved && event.description[locale] && (
                    <p>{event.description[locale]}</p>
                  )}
                  {event.venueSublocation && (
                    <p>{event.venueSublocation[locale]}</p>
                  )}
                  {event.dressCode && (
                    <p>
                      {t("dressCode")}: {event.dressCode[locale]}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
