export type OpeningPreview = { names: string; dateLabel: string; venue: string };
export type OpeningPhase = 'closed' | 'opening' | 'handoff' | 'open';
export function openingReducer(phase: OpeningPhase, event: 'OPEN' | 'HANDOFF' | 'COMPLETE' | 'SKIP' | 'REDUCE'): OpeningPhase {
  if (event === 'SKIP' || event === 'REDUCE' || event === 'COMPLETE') return 'open';
  if (event === 'OPEN' && phase === 'closed') return 'opening';
  if (event === 'HANDOFF' && phase === 'opening') return 'handoff';
  return phase;
}
/** Camera origin is viewport (0,0); the sheet and viewport use the same coordinates. */
export function paperFillTransform(letter: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }) {
  const scale = Math.max(viewport.width / letter.width, viewport.height / letter.height) * 1.05;
  return {
    translateX: viewport.width / 2 - (letter.x + letter.width / 2) * scale,
    translateY: viewport.height / 2 - (letter.y + letter.height / 2) * scale,
    scale,
  };
}
