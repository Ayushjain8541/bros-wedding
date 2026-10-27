'use client';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { useAnimate } from 'motion/react';
import { useTranslations } from 'next-intl';
import { PaperScene } from './PaperScene';
import { openingReducer, paperFillTransform, type OpeningPreview } from './opening-state';
import styles from './InvitationOpening.module.css';
import paper from './paper-tokens.module.css';

const OUT = [0.23, 1, 0.32, 1] as const;
const MOVE = [0.77, 0, 0.175, 1] as const;
type Controller = { stop: () => void };

export function InvitationOpening({ preview, onHandoff, onComplete }: { preview: OpeningPreview; onHandoff: () => void; onComplete: () => void }) {
  const t = useTranslations('Invitation');
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const [phase, dispatch] = useReducer(openingReducer, 'closed');
  const callbacks = useRef({ onHandoff, onComplete });
  const run = useRef({ id: 0, started: false, complete: false, handedOff: false, bounds: null as DOMRect | null, controls: [] as Controller[] });
  useEffect(() => { callbacks.current = { onHandoff, onComplete }; }, [onHandoff, onComplete]);
  const stop = useCallback(() => {
    run.current.id++;
    run.current.controls.forEach(control => control.stop());
    run.current.controls = [];
  }, []);
  const finish = useCallback(() => {
    if (run.current.complete) return;
    run.current.complete = true;
    stop();
    dispatch('COMPLETE');
    callbacks.current.onComplete();
  }, [stop]);
  useLayoutEffect(() => {
    const stage = scope.current;
    if (!stage) return;
    const print = stage.querySelector<HTMLElement>('[data-cover-print]');
    const label = stage.querySelector<HTMLElement>('[data-open-label]');
    const skip = stage.querySelector<HTMLAnchorElement>('a');
    if (!print || !label || !skip) return;
    let active = true;
    const fit = () => {
      if (!active || run.current.started || run.current.complete) return;
      const bounds = stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const landscape = bounds.height <= 550 && bounds.width >= 600;
      const top = landscape ? 76 : Math.max(90, print.getBoundingClientRect().bottom - bounds.top + 32);
      // Reserve the complete live control boxes, their 12px offset and a 12px gap.
      const bottom = skip.getBoundingClientRect().top - bounds.top - label.getBoundingClientRect().height - 24;
      const available = Math.max(44, bottom - top);
      const width = Math.min(bounds.width * (landscape ? .42 : .88), 560, available * 1.6);
      stage.style.setProperty('--scene-envelope-width', `${width}px`);
      stage.style.setProperty('--scene-envelope-x', `${bounds.width * (landscape ? .74 : .5)}px`);
      stage.style.setProperty('--scene-envelope-top', `${top + (available - width / 1.6) / 2}px`);
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
    observer?.observe(stage); observer?.observe(print); observer?.observe(skip);
    window.addEventListener('resize', fit);
    // Swap fonts can change wrapping after hydration; fit remains immediate even
    // if a font never arrives. Once activated, geometry stays fixed for the run.
    void document.fonts?.ready.then(fit);
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', fit); };
  }, [scope]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { if (query.matches) finish(); };
    change(); query.addEventListener('change', change);
    // Overflow locking leaves the persistent document in flow and its height intact.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const stage = scope.current;
    const resize = () => {
      const initial = run.current.bounds;
      const next = stage?.getBoundingClientRect();
      if (run.current.started && initial && next && (Math.abs(next.width - initial.width) > 1 || Math.abs(next.height - initial.height) > 1)) finish();
    };
    window.addEventListener('resize', resize);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    if (stage) observer?.observe(stage);
    return () => {
      stop(); query.removeEventListener('change', change);
      window.removeEventListener('resize', resize); observer?.disconnect();
      document.body.style.overflow = previous;
    };
  }, [finish, scope, stop]);

  function open() {
    if (run.current.started || run.current.complete) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    run.current.started = true;
    const id = ++run.current.id;
    dispatch('OPEN');
    const stage = scope.current;
    const letter = stage?.querySelector<HTMLElement>('[data-letter]');
    if (!stage || !letter) { finish(); return; }
    const bounds = stage.getBoundingClientRect();
    run.current.bounds = bounds;
    const rect = letter.getBoundingClientRect();
    const fill = paperFillTransform({ x: rect.x - bounds.x, y: rect.y - bounds.y - rect.height * .34, width: rect.width || 1, height: rect.height || 1 }, { width: bounds.width || 1, height: bounds.height || 1 });
    try {
      const sequence = animate([
        ['[data-seal]', { transform: ['translateY(0px) scale(1)', 'translateY(2px) scale(.96)'] }, { at: 0, duration: .12, ease: OUT }],
        ['[data-seal]', { transform: ['translateY(2px) rotate(0deg) scale(.96)', 'translateY(-18px) rotate(-6deg) scale(1)'], opacity: [1, 0] }, { at: .12, duration: .3, ease: OUT }],
        ['[data-cover-print], [data-open-label]', { opacity: [1, 0] }, { at: 0, duration: .2, ease: OUT }],
        ['[data-letter]', { transform: ['translateY(0%)', 'translateY(-34%)'] }, { at: .7, duration: .9, ease: MOVE }],
        ['[data-camera]', { transform: ['translate(0px, 0px) scale(1)', `translate(${fill.translateX}px, ${fill.translateY}px) scale(${fill.scale})`] }, { at: 1.5, duration: .78, ease: MOVE }],
        ['[data-envelope-body], [data-fold], [data-still-life], [data-letter-print]', { opacity: [1, 0] }, { at: 1.5, duration: .5, ease: OUT }],
        [stage, { opacity: [1, 0] }, { at: 2.28, duration: .32, ease: OUT }],
      ]);
      const fold = animate('[data-fold]', { transform: ['rotateX(0deg)', 'rotateX(-172deg)'] }, { delay: .26, duration: .79, ease: MOVE });
      void fold.then(() => {
        if (run.current.id !== id || run.current.complete) return;
        // Explicitly place the opened flap behind the rising letter. Safari's
        // nested 3D stacking otherwise keeps the original front-face order.
        const folded = stage.querySelector<HTMLElement>('[data-fold]');
        if (folded) folded.style.zIndex = '1';
      });
      // Completion follows the scoped animation clock, never elapsed wall time.
      const handoff = animate('[data-handoff-clock]', { opacity: [0, 1] }, { duration: 2, ease: 'linear' });
      run.current.controls = [sequence, fold, handoff];
      void handoff.then(() => {
        if (run.current.id !== id || run.current.complete || run.current.handedOff) return;
        run.current.handedOff = true;
        dispatch('HANDOFF'); callbacks.current.onHandoff();
      });
      void sequence.then(() => { if (run.current.id === id) finish(); });
    } catch { finish(); }
  }
  return <div ref={scope} className={styles.scene} data-testid="opening-scene" data-phase={phase}>
    <PaperScene preview={preview}/>
    <button type="button" className={`${styles.openButton} ${paper.controls}`} aria-label={phase === 'closed' ? t('open') : t('opening')} onClick={open}>
      <span data-open-label>{t('open')} <span aria-hidden="true">↗</span></span>
    </button>
    <a className={`${styles.skip} ${paper.controls}`} href="/invitation?opened=1#welcome" onClick={event => { event.preventDefault(); finish(); }}>{t('skip')}</a>
    <span className={styles.srOnly} role="status" aria-live="polite">{phase !== 'closed' ? t('opening') : ''}</span>
    <span className={styles.clock} data-handoff-clock aria-hidden="true"/>
  </div>;
}
