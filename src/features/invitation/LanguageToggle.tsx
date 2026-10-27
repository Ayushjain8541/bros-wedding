'use client';
import type { Locale } from '@/features/wedding/types';
import styles from './Invitation.module.css';
export function LanguageToggle({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  return <div className={styles.languages} role="group" aria-label={locale === 'hi' ? 'भाषा' : 'Language'}>
    <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => onChange('en')}>English</button>
    <span aria-hidden="true"/>
    <button type="button" lang="hi" aria-pressed={locale === 'hi'} onClick={() => onChange('hi')}>हिन्दी</button>
  </div>;
}
