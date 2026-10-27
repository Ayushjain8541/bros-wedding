import { useTranslations } from 'next-intl';
import type { ContentSnapshot, Locale, SiteSettings } from '@/features/wedding/types';
import styles from './Invitation.module.css';
export function VenueHelp({ wedding, settings, locale }: { wedding: ContentSnapshot['wedding']; settings: SiteSettings; locale: Locale }) {
  const t = useTranslations('Invitation');
  return <section id="venue" className={`${styles.section} ${styles.venue}`} aria-labelledby="venue-title">
    <div className={styles.venueDetails}><h2 id="venue-title">{t('venue')}</h2><h3>{wedding.venueName[locale]}</h3><p>{wedding.address[locale]}</p><a className={styles.textLink} href={wedding.mapUrl} target="_blank" rel="noreferrer">{t('openMap')} <span aria-hidden="true">↗</span></a></div>
    <div className={styles.help}><h2>{t('help')}</h2><p>{t('helpNote')}</p><p className={styles.phone}>{settings.helpPhone}</p><div className={styles.contactLinks}><a className={styles.solidLink} href={settings.helpWhatsAppUrl} target="_blank" rel="noreferrer">{t('whatsapp')}</a><a className={styles.outlineLink} href={settings.helpTelUrl}>{t('call')}</a></div></div>
  </section>;
}
