import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type { ContentSnapshot, Locale } from '@/features/wedding/types';
import { PAPER_ASSETS } from './paper-assets';
import styles from './InvitationOpening.module.css';
import paper from './paper-tokens.module.css';

export function WelcomeHero({ content, locale, dateLabel, headingRef, revealed }: { content: ContentSnapshot; locale: Locale; dateLabel: string; headingRef: RefObject<HTMLHeadingElement | null>; revealed: boolean }) {
  const t = useTranslations('Invitation');
  return <section id="welcome" className={styles.hero} aria-labelledby="couple-title" data-revealed={revealed}>
    <div className={styles.heroSprig} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...PAPER_ASSETS.sprig} alt=""/>
    </div>
    <div className={styles.heroCopy}>
      <p className={`${styles.welcomeKicker} ${paper.editorial}`}>{t('invited')}</p>
      <span className={styles.markPlaceholder}>{t('markPlaceholder')}</span>
      <h1 ref={headingRef} tabIndex={-1} id="couple-title" className={locale === 'hi' ? paper.hindiDisplay : paper.latinDisplay}>{content.couple.displayName[locale]}</h1>
      <p className={`${styles.welcomeCopy} ${paper.editorial}`}>{content.welcome[locale]}</p>
      <span className={styles.rule} aria-hidden="true"/>
      <p data-testid="wedding-date" className={styles.weddingDate}>{dateLabel}</p>
      <p className={styles.venue}>{content.wedding.venueName[locale]}</p>
      <a className={`${styles.explore} ${paper.controls}`} href="#celebrations">{t('exploreCelebrations')} <span aria-hidden="true">↓</span></a>
    </div>
  </section>;
}
