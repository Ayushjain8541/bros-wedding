import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvelopeReveal } from '@/features/invitation/EnvelopeReveal';
import { Invitation } from '@/features/invitation/Invitation';
import en from '@/i18n/messages/en.json';
import { CONTENT, EVENTS, SETTINGS } from '../fixtures/wedding';

function media(reduced = false) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
function reveal(onOpen = vi.fn()) {
  render(<NextIntlClientProvider locale="en" messages={en}><EnvelopeReveal onOpen={onOpen}/></NextIntlClientProvider>);
  return onOpen;
}
beforeEach(() => { media(); Element.prototype.scrollIntoView = vi.fn(); });
describe('invitation opening', () => {
  it('skip immediately opens, even after an artwork load error', async () => {
    const user = userEvent.setup(); const onOpen = reveal();
    document.querySelectorAll('img').forEach(img => fireEvent.error(img));
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it.each(['{Enter}', ' '])('opens from the keyboard with %s within 1.8 seconds', async key => {
    const user = userEvent.setup(); const onOpen = reveal();
    screen.getByRole('button', { name: 'Open invitation' }).focus();
    await user.keyboard(key);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1), { timeout: 1800 });
  });
  it('allows immediate skip while the envelope is opening without double completion', async () => {
    const user = userEvent.setup(); const onOpen = reveal();
    await user.click(screen.getByRole('button', { name: 'Open invitation' }));
    await user.click(screen.getByRole('button', { name: /skip/i }));
    await new Promise(resolve => setTimeout(resolve, 1350));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it('reduced motion bypasses the cover', async () => {
    media(true); const onOpen = reveal();
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });
  it('replays, switches locale without replacing content nodes, and keeps help usable', async () => {
    const user = userEvent.setup();
    render(<Invitation content={CONTENT} events={EVENTS} settings={SETTINGS} locale="en"/>);
    await user.click(screen.getByRole('button', { name: /skip/i }));
    const story = screen.getByTestId('story-copy');
    expect(story.textContent).toBe(CONTENT.story.en);
    await user.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(screen.getByTestId('story-copy')).toBe(story);
    expect(story.textContent).toBe(CONTENT.story.hi);
    expect(document.documentElement.lang).toBe('hi');
    expect(document.cookie).toContain('locale=hi');
    expect(screen.getByRole('link', { name: 'कॉल करें' })).toHaveAttribute('href', SETTINGS.helpTelUrl);
    await user.click(screen.getByRole('button', { name: 'फिर से खोलें' }));
    expect(screen.getByRole('button', { name: 'निमंत्रण खोलें' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'खुलने का एनीमेशन छोड़ें' }));
    expect(screen.getByTestId('story-copy')).toBe(story);
  });
});
