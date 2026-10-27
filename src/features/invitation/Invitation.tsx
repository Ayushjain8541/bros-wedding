'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { ContentSnapshot, Locale, SiteSettings, WeddingEvent } from '@/features/wedding/types';
import en from '@/i18n/messages/en.json';
import hi from '@/i18n/messages/hi.json';
import { EnvelopeReveal } from './EnvelopeReveal';
import { LanguageToggle } from './LanguageToggle';
import { StoryCollage } from './StoryCollage';
import { Celebrations } from './Celebrations';
import { VenueHelp } from './VenueHelp';
import styles from './Invitation.module.css';

type Props = { content: ContentSnapshot; events: WeddingEvent[]; settings: SiteSettings; locale: Locale };
function dateRange(content: ContentSnapshot, locale: Locale) {
  const formatter = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  return formatter.formatRange(new Date(`${content.wedding.startDate}T12:00:00+05:30`), new Date(`${content.wedding.endDate}T12:00:00+05:30`)).replace(/\s+/g, ' ');
}
export function Invitation(props: Props) {
  const [locale, setLocale] = useState(props.locale);
  const messages = locale === 'hi' ? hi : en;
  function changeLocale(next: Locale) {
    document.cookie = `locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    document.documentElement.lang = next;
    setLocale(next);
  }
  return <NextIntlClientProvider locale={locale} messages={{ ...messages, Invitation: { ...messages.Invitation, ...props.content.labels[locale] } }} timeZone="Asia/Kolkata">
    <InvitationDocument {...props} locale={locale} onLocaleChange={changeLocale}/>
  </NextIntlClientProvider>;
}
function InvitationDocument({ content, events, settings, locale, onLocaleChange }: Props & { onLocaleChange: (locale: Locale) => void }) {
  const t = useTranslations('Invitation');
  const [cover, setCover] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const finish = useCallback(() => { opened.current = true; setCover(false); }, []);
  useEffect(() => {
    if (!cover && opened.current) heading.current?.focus({ preventScroll: true });
    if (!cover && opened.current) heading.current?.scrollIntoView({ block: 'start' });
  }, [cover]);
  function replay() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { heading.current?.focus(); return; }
    setCover(true);
    requestAnimationFrame(() => {
      coverRef.current?.scrollIntoView({ block: 'start' });
      coverRef.current?.querySelector('button')?.focus({ preventScroll: true });
    });
  }
  const families = content.families[locale].split(/\n\s*\n/);
  return <div className={styles.invitation} lang={locale}>
    <header className={styles.header}>
      <a className={styles.skipLink} href="#welcome">{t('skipToContent')}</a>
      <a className={styles.headerTitle} href="#welcome">{t('weddingInvitation')}</a>
      <LanguageToggle locale={locale} onChange={onLocaleChange}/>
    </header>
    {cover && <div ref={coverRef} className={styles.cover}>
      <div className={`${styles.botanical} ${styles.coverFlowers}`} aria-hidden="true"/>
      <div className={styles.coverContent}><p className={styles.coverTitle}>{t('invited')}</p><p className={styles.coverNames}>{content.couple.displayName[locale]}</p><EnvelopeReveal onOpen={finish}/></div>
    </div>}
    <nav className={styles.navigation} aria-label={t('navigation')}>
      {(['welcome', 'families', 'story', 'celebrations', 'venue'] as const).map(id => <a key={id} href={`#${id}`}>{t(id)}</a>)}
    </nav>
    <main>
      <section id="welcome" className={`${styles.section} ${styles.welcome}`} aria-labelledby="couple-title">
        <div className={`${styles.botanical} ${styles.welcomeFlowersLeft}`} aria-hidden="true"/><div className={`${styles.botanical} ${styles.welcomeFlowersRight}`} aria-hidden="true"/>
        <div className={styles.welcomeInner}>
          <div className={styles.markPlaceholder}>{t('markPlaceholder')}</div>
          <h1 ref={heading} tabIndex={-1} id="couple-title">{content.couple.displayName[locale]}</h1>
          <p className={styles.welcomeCopy}>{content.welcome[locale]}</p>
          <svg className={styles.flourish} viewBox="0 0 120 30" aria-hidden="true"><path d="M5 15h38m34 0h38M49 15q11-18 22 0-11 18-22 0Z"/></svg>
          <p data-testid="wedding-date" className={styles.weddingDate}>{dateRange(content, locale)}</p>
          <p className={styles.welcomeVenue}>{content.wedding.venueName[locale]}</p>
          <a className={styles.textLink} href="#celebrations">{t('exploreCelebrations')} <span aria-hidden="true">↓</span></a>
        </div>
      </section>
      {locale === 'hi' && !content.hindiApproved && <p className={styles.draftNote}>{t('draftHindi')}</p>}
      <section id="families" className={`${styles.section} ${styles.families}`} aria-labelledby="families-title">
        <h2 id="families-title">{t('families')}</h2><p className={styles.sectionNote}>{t('familyBlessings')}</p>
        <div data-testid="families-copy" className={styles.familyColumns}>{families.map((family, index) => <p key={index}>{family}</p>)}</div>
      </section>
      <StoryCollage content={content} locale={locale}/>
      <Celebrations events={events} locale={locale} ceremonyCopyApproved={content.ceremonyCopyApproved}/>
      <section className={`${styles.section} ${styles.response}`} aria-labelledby="response-title"><h2 id="response-title">{t('responseTitle')}</h2><p>{t('rsvpUnavailable')}</p><button type="button" disabled>{t('rsvpSoon')}</button></section>
      <VenueHelp wedding={content.wedding} settings={settings} locale={locale}/>
    </main>
    <footer className={styles.footer}><p>{content.couple.displayName[locale]}</p><span>{dateRange(content, locale)}</span><button type="button" onClick={replay}>{t('replay')}</button></footer>
  </div>;
}
