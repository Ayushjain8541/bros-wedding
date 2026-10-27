import { useTranslations } from "next-intl";
import type { ContentSnapshot, Locale } from "@/features/wedding/types";
import styles from "./Invitation.module.css";

export function StoryCollage({
  content,
  locale,
}: {
  content: Pick<ContentSnapshot, "story" | "photos">;
  locale: Locale;
}) {
  const t = useTranslations("Invitation");
  return (
    <section
      id="story"
      className={`${styles.section} ${styles.story}`}
      aria-labelledby="story-title"
    >
      <div className={styles.storyText}>
        <h2 id="story-title">{t("story")}</h2>
        <p data-testid="story-copy" className={styles.storyCopy}>
          {content.story[locale]}
        </p>
        <svg
          className={styles.flourish}
          viewBox="0 0 120 30"
          aria-hidden="true"
        >
          <path d="M5 15h38m34 0h38M49 15q11-18 22 0-11 18-22 0Z" />
        </svg>
      </div>
      <div className={styles.collage} aria-label={t("photoCollection")}>
        {content.photos.length
          ? content.photos.map((photo, index) => (
              <figure
                key={photo.id}
                className={index === 0 ? styles.mainPhoto : styles.smallPhoto}
              >
                {/* Protected redirect deliberately bypasses the public Next image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/photos/${photo.id}`}
                  alt={photo.alt[locale]}
                  width={640}
                  height={480}
                  loading="lazy"
                  style={{ width: "100%", height: "auto", objectFit: "cover" }}
                />
              </figure>
            ))
          : Array.from({ length: 5 }, (_, index) => (
              <figure
                key={index}
                className={index === 0 ? styles.mainPhoto : styles.smallPhoto}
              >
                <div className={styles.photoMat}>
                  {/* Decorative image can fail without removing the visible placeholder text. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/art/placeholder.svg"
                    alt=""
                    width="120"
                    height="120"
                    loading="lazy"
                  />
                  <span>
                    {index === 0 ? t("couplePhoto") : t("photoPlaceholder")}
                  </span>
                </div>
                {index === 0 && <figcaption>{t("photosSoon")}</figcaption>}
              </figure>
            ))}
      </div>
    </section>
  );
}
