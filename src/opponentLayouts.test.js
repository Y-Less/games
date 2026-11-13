// Where each opponent's hand goes round a card table.  The table is pure data, so what can go wrong is a slip of the
// pen when a row is added or edited: an opponent listed twice, one left out, or seats that no longer run clockwise.
// The rules checked are the ones the file's own header states: opponents are numbered clockwise from you (the player
// after you is 0), and left (bottom to top), then top (left to right), then right (top to bottom) is clockwise.
import { describe, expect, it } from 'vitest';
import { MAX_OPPONENTS, OPPONENT_LAYOUTS } from './opponentLayouts.js';

const counts = Object.keys(OPPONENT_LAYOUTS).map(Number);

describe('the opponent layouts', () => {
  it('has a layout for every number of opponents from one to the most a table can seat, and for no other', () => {
    expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: MAX_OPPONENTS }, (_, i) => i + 1));
  });

  it('says the most opponents is the largest layout there is', () => {
    expect(MAX_OPPONENTS).toBe(Math.max(...counts));
  });

  it.each(counts)('seats each of %i opponents exactly once, clockwise from the left round to the right', (count) => {
    const { left, top, right } = OPPONENT_LAYOUTS[count];
    expect([...left, ...top, ...right]).toEqual(Array.from({ length: count }, (_, i) => i));
  });

  it.each(counts)('gives each of the three sides a list for %i opponents, even an empty one', (count) => {
    const layout = OPPONENT_LAYOUTS[count];
    expect(Object.keys(layout).sort()).toEqual(['left', 'right', 'top']);
    for (const side of Object.values(layout)) expect(Array.isArray(side)).toBe(true);
  });
});
