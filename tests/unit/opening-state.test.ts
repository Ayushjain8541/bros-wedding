import { describe, expect, it } from 'vitest';
import { openingReducer, paperFillTransform, type OpeningPhase } from '@/features/invitation/opening-state';

describe('opening state and camera geometry', () => {
  it.each<OpeningPhase>(['closed', 'opening', 'handoff', 'open'])('skip/reduce resolves %s immediately', phase => {
    expect(openingReducer(phase, 'SKIP')).toBe('open');
    expect(openingReducer(phase, 'REDUCE')).toBe('open');
    expect(openingReducer(openingReducer(phase, 'COMPLETE'), 'COMPLETE')).toBe('open');
  });
  it('progresses in order and ignores stale events', () => {
    expect(openingReducer('closed', 'OPEN')).toBe('opening');
    expect(openingReducer('opening', 'HANDOFF')).toBe('handoff');
    expect(openingReducer('handoff', 'OPEN')).toBe('handoff');
    expect(openingReducer('open', 'HANDOFF')).toBe('open');
  });
  it('uniformly fills all edges with a 5% overscan, around the viewport origin', () => {
    const letter = { x: 100, y: 200, width: 200, height: 300 };
    const viewport = { width: 400, height: 800 };
    const result = paperFillTransform(letter, viewport);
    expect(result.scale).toBeCloseTo(2.8);
    expect(result.translateX).toBeCloseTo(-360);
    expect(result.translateY).toBeCloseTo(-580);
    expect(letter.x * result.scale + result.translateX).toBeLessThanOrEqual(0);
    expect(letter.y * result.scale + result.translateY).toBeLessThanOrEqual(0);
    expect((letter.x + letter.width) * result.scale + result.translateX).toBeGreaterThanOrEqual(viewport.width);
    expect((letter.y + letter.height) * result.scale + result.translateY).toBeGreaterThanOrEqual(viewport.height);
  });
});
