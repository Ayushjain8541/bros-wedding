import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ContentEditor } from '@/features/organizer/ContentEditor';
import { CONTENT, EVENTS, SETTINGS } from '../fixtures/wedding';
it('locks edits and actions during a pending explicit reload, then adopts the published revision', async () => {
  let finish!: (r:Response)=>void;
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  try {
    render(<ContentEditor initial={{content:CONTENT,events:EVENTS,settings:SETTINGS}}/>);
    fireEvent.click(screen.getByRole('button',{name:/Reload published/}));
    expect(screen.getByLabelText('Display names · English')).toBeDisabled();
    expect(screen.getByRole('button',{name:/Reload published/})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Publish photo'})).toBeDisabled();
    finish(new Response(JSON.stringify({content:{...CONTENT,revision:2,couple:{...CONTENT.couple,displayName:{en:'Reloaded sample',hi:'उदाहरण'}}},events:EVENTS,settings:SETTINGS})));
    await waitFor(()=>expect(screen.getByLabelText('Display names · English')).toHaveValue('Reloaded sample'));
    expect(screen.getByLabelText('Display names · English')).toBeEnabled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {fetcher.mockRestore();}
});
it('aborts a pending reload on unmount',()=>{
  let signal:AbortSignal|undefined;
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>{signal=init?.signal as AbortSignal;return new Promise(()=>{});});
  try {const view=render(<ContentEditor initial={{content:CONTENT,events:EVENTS,settings:SETTINGS}}/>);fireEvent.click(screen.getByRole('button',{name:/Reload published/}));view.unmount();expect(signal?.aborted).toBe(true);}finally{fetcher.mockRestore();}
});
