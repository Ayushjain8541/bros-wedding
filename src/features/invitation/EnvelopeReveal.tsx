'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './EnvelopeReveal.module.css';

export function EnvelopeReveal({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('Invitation');
  const [opening, setOpening] = useState(false);
  const completed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    clearTimeout(timer.current);
    onOpen();
  }, [onOpen]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (query.matches) finish();
    const change = () => { if (query.matches) finish(); };
    query.addEventListener('change', change);
    return () => { clearTimeout(timer.current); query.removeEventListener('change', change); };
  }, [finish]);
  function open() {
    if (opening || completed.current) return;
    setOpening(true);
    timer.current = setTimeout(finish, 1200);
  }
  return <div className={styles.reveal} data-opening={opening}>
    <button type="button" className={styles.envelope} aria-label={t('open')} onClick={open}>
      <span className={styles.letter} aria-hidden="true"><span>{t('invited')}</span><svg viewBox="0 0 60 30"><path d="M5 15h18m14 0h18M30 5l7 10-7 10-7-10z"/></svg></span>
      <span className={styles.pocket} aria-hidden="true"/>
      <span className={styles.flap} aria-hidden="true"/>
      <span className={styles.seal} aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M10 29c15-3 18-12 19-20-12 0-20 7-19 20Zm0 0L25 14"/></svg></span>
      <span className={styles.openLabel}>{opening ? t('opening') : t('open')} <span aria-hidden="true">→</span></span>
    </button>
    <button type="button" className={styles.skip} onClick={finish}>{t('skip')}</button>
  </div>;
}
