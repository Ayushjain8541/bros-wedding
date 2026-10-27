import { useTranslations } from 'next-intl';
import type { ContentSnapshot, Locale } from '@/features/wedding/types';
import styles from './Invitation.module.css';

// Private storage paths are deliberately not treated as browser URLs. Approved
// photos will be delivered through the authenticated photo service in its task.
export function StoryCollage({ content, locale }: { content: Pick<ContentSnapshot, 'story'>; locale: Locale }) {
  const t = useTranslations('Invitation');
  return <section id="story" className={`${styles.section} ${styles.story}`} aria-labelledby="story-title">
    <div className={styles.storyText}>
      <h2 id="story-title">{t('story')}</h2>
      <p data-testid="story-copy" className={styles.storyCopy}>{content.story[locale]}</p>
      <svg className={styles.flourish} viewBox="0 0 120 30" aria-hidden="true"><path d="M5 15h38m34 0h38M49 15q11-18 22 0-11 18-22 0Z"/></svg>
    </div>
    <div className={styles.collage} aria-label={t('photoCollection')}>
      {Array.from({ length: 5 }, (_, index) => <figure key={index} className={index === 0 ? styles.mainPhoto : styles.smallPhoto}>
        <div className={styles.photoMat}>
          {/* Decorative image can fail without removing the visible placeholder text. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/placeholder.svg" alt="" width="120" height="120" loading="lazy"/>
          <span>{index === 0 ? t('couplePhoto') : t('photoPlaceholder')}</span>
        </div>
        {index === 0 && <figcaption>{t('photosSoon')}</figcaption>}
      </figure>)}
    </div>
  </section>;
}
