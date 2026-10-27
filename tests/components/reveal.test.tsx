import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Invitation } from '@/features/invitation/Invitation';
import { CONTENT, EVENTS, SETTINGS } from '../fixtures/wedding';

const motion = vi.hoisted(() => ({ hold: false, runs: [] as { stop: ReturnType<typeof vi.fn>; resolve: () => void }[] }));
vi.mock('motion/react', async importOriginal => {
  const actual = await importOriginal<typeof import('motion/react')>();
  const React = await import('react');
  return { useAnimate: () => {
    const [scope, realAnimate] = actual.useAnimate();
    const animate = React.useCallback((...args: Parameters<typeof realAnimate>) => {
      if (!motion.hold) {
        const controller = realAnimate(...args);
        const stop = vi.spyOn(controller, 'stop');
        motion.runs.push({ stop, resolve: () => {} });
        return controller;
      }
      let resolve!: () => void;
      const promise = new Promise<void>(done => { resolve = done; });
      const stop = vi.fn();
      motion.runs.push({ stop, resolve });
      return Object.assign(promise, { stop });
    }, [realAnimate]);
    return [scope, animate];
  } };
});
let reduced = false;
let change: (() => void) | undefined;
beforeEach(() => {
  motion.hold = false; motion.runs.length = 0; reduced = false; change = undefined;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => { change = fn; }, removeEventListener: vi.fn() })));
  vi.stubGlobal('scrollTo', vi.fn());
});
function invitation() { return render(<Invitation content={CONTENT} events={EVENTS} settings={SETTINGS} locale="en"/>); }
function open() { fireEvent.click(screen.getByRole('button', { name: 'Open invitation' })); }
function skip() { fireEvent.click(screen.getByRole('link', { name: 'Skip opening animation' })); }
describe('invitation opening lifecycle', () => {
  it('uses a native skip destination and completes immediately after failed art', () => {
    invitation();
    const link = screen.getByRole('link', { name: 'Skip opening animation' });
    expect(link).toHaveAttribute('href', '/invitation?opened=1#welcome');
    document.querySelectorAll('img').forEach(img => fireEvent.error(img));
    skip();
    expect(screen.queryByTestId('opening-scene')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });
  it('elapsed wall time alone cannot remove the scene; locale retains the active run', async () => {
    motion.hold = true; vi.useFakeTimers();
    invitation(); open();
    const scene = screen.getByTestId('opening-scene');
    const runs = motion.runs.length;
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByTestId('opening-scene')).toBe(scene);
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(screen.getByTestId('opening-scene')).toBe(scene);
    expect(motion.runs).toHaveLength(runs);
    expect(screen.getByRole('button', { name: 'आपका निमंत्रण खुल रहा है…' })).toBeInTheDocument();
    vi.useRealTimers();
  });
  it('dynamic reduced motion cancels every pending controller and completes once', async () => {
    invitation(); open();
    const title = document.querySelector('h1')!;
    const focus = vi.spyOn(title, 'focus');
    act(() => { reduced = true; change?.(); });
    expect(screen.queryByTestId('opening-scene')).not.toBeInTheDocument();
    expect(motion.runs.every(run => run.stop.mock.calls.length > 0)).toBe(true);
    await act(async () => { motion.runs.forEach(run => run.resolve()); });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
  it('unmount cancels pending animation and restores only owned body styles', () => {
    document.body.style.overflow = 'clip'; document.body.style.color = 'red';
    const view = invitation(); open(); view.unmount();
    expect(motion.runs.length).toBeGreaterThan(0);
    expect(motion.runs.every(run => run.stop.mock.calls.length > 0)).toBe(true);
    expect(document.body.style.overflow).toBe('clip');
    expect(document.body.style.color).toBe('red');
    document.body.removeAttribute('style');
  });
  it('replay and locale keep live content nodes and immediate skips reveal typography', () => {
    invitation(); skip();
    const story = screen.getByTestId('story-copy');
    const title = screen.getByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(screen.getByTestId('story-copy')).toBe(story);
    expect(story.textContent).toBe(CONTENT.story.hi);
    fireEvent.click(screen.getByRole('button', { name: 'फिर से खोलें' }));
    fireEvent.click(screen.getByRole('link', { name: 'खुलने का एनीमेशन छोड़ें' }));
    expect(screen.getByRole('heading', { level: 1 })).toBe(title);
    expect(title.closest('[data-revealed]')).toHaveAttribute('data-revealed', 'true');
    expect(screen.getByRole('link', { name: 'कॉल करें' })).toHaveAttribute('href', SETTINGS.helpTelUrl);
  });
});
