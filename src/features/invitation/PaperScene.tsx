'use client';
import { useLocale, useTranslations } from 'next-intl';
import { PAPER_ASSETS } from './paper-assets';
import type { OpeningPreview } from './opening-state';
import styles from './InvitationOpening.module.css';
import paper from './paper-tokens.module.css';

export function PaperScene({ preview }: { preview: OpeningPreview }) {
  const locale = useLocale();
  const t = useTranslations('Invitation');
  function art(key: keyof typeof PAPER_ASSETS, className?: string) {
    // Registered cutouts need their complete canvas, without Next image recropping.
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...PAPER_ASSETS[key]} alt="" draggable={false} className={className} onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/>;
  }
  return <>
    <div className={styles.coverPrint} data-cover-print>
      <p className={paper.editorial}>{t('invited')}</p>
      <p className={locale === 'hi' ? paper.hindiDisplay : paper.latinDisplay}>{preview.names}</p>
      <p className={styles.coverDate}>{preview.dateLabel}</p>
    </div>
    <div className={styles.sprig} data-still-life aria-hidden="true">{art('sprig')}</div>
    <div className={styles.camera} data-camera aria-hidden="true">
      <div className={styles.envelope} data-envelope>
        <div className={styles.back} data-envelope-body>{art('back')}</div>
        <div className={styles.letter} data-letter>
          {art('letter')}
          <div className={styles.letterPrint} data-letter-print>
            <span>{t('invited')}</span><span>{preview.dateLabel}</span><span>{preview.venue}</span>
          </div>
        </div>
        <div className={styles.pocket} data-envelope-body>{art('pocket')}</div>
        <div className={styles.fold} data-fold>
          <div className={styles.flapFront}>{art('flapFront')}</div>
          <div className={styles.flapBack}>{art('flapBack')}</div>
        </div>
        <div className={styles.seal} data-seal>{art('seal')}</div>
      </div>
    </div>
  </>;
}
