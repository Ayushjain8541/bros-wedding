'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { ContentSnapshot, Locale, SiteSettings, WeddingEvent } from '@/features/wedding/types';
import en from '@/i18n/messages/en.json';
import hi from '@/i18n/messages/hi.json';
import { InvitationOpening } from './InvitationOpening';
import { WelcomeHero } from './WelcomeHero';
import paper from './paper-tokens.module.css';
import { LanguageToggle } from './LanguageToggle';
import { StoryCollage } from './StoryCollage';
import { Celebrations } from './Celebrations';
import { VenueHelp } from './VenueHelp';
import styles from './Invitation.module.css';

type Props = { content: ContentSnapshot; events: WeddingEvent[]; settings: SiteSettings; locale: Locale; initiallyOpened?: boolean };
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
function InvitationDocument({ content, events, settings, locale, onLocaleChange, initiallyOpened }: Props & { onLocaleChange: (locale: Locale) => void }) {
  const t = useTranslations('Invitation');
  const [cover, setCover] = useState(!initiallyOpened);
  const heading = useRef<HTMLHeadingElement>(null);
  const [revealed, setRevealed] = useState(Boolean(initiallyOpened));
  const opened = useRef(false);
  const replaying = useRef(false);
  const finish = useCallback(() => { opened.current = true; setRevealed(true); setCover(false); }, []);
  const handoff = useCallback(() => setRevealed(true), []);
  useEffect(() => {
    if (!cover && opened.current) heading.current?.focus({ preventScroll: true });
  }, [cover]);
  useLayoutEffect(() => {
    if (cover && replaying.current) {
      // The opaque fixed layer is committed before we recenter its live document.
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.querySelector<HTMLButtonElement>('[data-testid="opening-scene"] button')?.focus({ preventScroll: true });
      replaying.current = false;
    }
  }, [cover]);
  function replay() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { heading.current?.focus({ preventScroll: true }); return; }
    replaying.current = true;
    setRevealed(false); setCover(true);
  }
  const families = content.families[locale].split(/\n\s*\n/);
  return <div className={`${styles.invitation} ${paper.paperSurface}`} lang={locale}>
    <header className={`${styles.header} ${cover ? styles.coverHeader : ''}`}>
      <a className={styles.skipLink} href="/invitation?opened=1#welcome" onClick={event => { if (cover) { event.preventDefault(); finish(); } }}>{t('skipToContent')}</a>
      <a className={styles.headerTitle} href="/invitation?opened=1#welcome" onClick={event => { if (cover) { event.preventDefault(); finish(); } }}>{t('weddingInvitation')}</a>
      <LanguageToggle locale={locale} onChange={onLocaleChange}/>
    </header>
    {cover && <InvitationOpening preview={{ names: content.couple.displayName[locale], dateLabel: dateRange(content, locale), venue: content.wedding.venueName[locale] }} onHandoff={handoff} onComplete={finish}/>}
    <div inert={cover} data-document-covered={cover}>
    <nav className={styles.navigation} data-covered={cover} aria-label={t('navigation')}>
      {(['welcome', 'families', 'story', 'celebrations', 'venue'] as const).map(id => <a key={id} href={`#${id}`}>{t(id)}</a>)}
    </nav>
    <main>
      <WelcomeHero content={content} locale={locale} dateLabel={dateRange(content, locale)} headingRef={heading} revealed={revealed}/>
      {locale === 'hi' && !content.hindiApproved && <p className={styles.draftNote}>{t('draftHindi')}</p>}
      <section id="families" className={`${styles.section} ${styles.families}`} aria-labelledby="families-title">
        <h2 id="families-title">{t('families')}</h2><p className={styles.sectionNote}>{t('familyBlessings')}</p>
        <div data-testid="families-copy" className={styles.familyColumns}>{families.map((family, index) => <p key={index}>{family}</p>)}</div>
      </section>
      <StoryCollage content={content} locale={locale}/>
      <Celebrations events={events} locale={locale} ceremonyCopyApproved={content.ceremonyCopyApproved}/>
      <section className={`${styles.section} ${styles.response}`} aria-labelledby="response-title"><h2 id="response-title">{t('responseTitle')}</h2><p>{t('rsvpNote')}</p><a className={styles.textLink} href="/rsvp">{t('rsvp')}</a></section>
      <VenueHelp wedding={content.wedding} settings={settings} locale={locale}/>
    </main>
    <footer className={styles.footer}><p>{content.couple.displayName[locale]}</p><span>{dateRange(content, locale)}</span><button type="button" onClick={replay}>{t('replay')}</button></footer>
    </div>
  </div>;
}
