'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export function InviteExchange() {
  const t = useTranslations("Access");
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // React Strict Mode replays effects. Preserve this request across that replay;
    // an abort/cleanup would consume an attempt and lose the already-cleared code.
    if (started.current) return;
    started.current = true;
    const code = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    void Promise.resolve().then(async () => {
        if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('ACCESS_FAILED');
        const response = await fetch('/api/access', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), cache: 'no-store' });
        if (!response.ok) throw new Error('ACCESS_FAILED');
        const result: unknown = await response.json();
        if (!result || typeof result !== 'object' || !('redirectTo' in result) || result.redirectTo !== '/invitation') throw new Error('ACCESS_FAILED');
        // A full document navigation drops every previous group's router cache.
        window.location.replace('/invitation');
      })
      .catch(() => setFailed(true));
  }, []);
  return failed
    ? <p role="alert">{t("failed")}</p>
    : <p role="status">{t("opening")}</p>;
}
