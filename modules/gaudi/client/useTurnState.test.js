import { describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { useTurnState } from './useTurnState.js';

/** A small view: three seats, you are seat 1, and it is seat 1's turn. */
const view = (extra = {}) => ({
  phase: 'playing',
  you: 1,
  seats: [{ name: 'ann', picked: true }, { name: 'bob', picked: false, window: { rows: ['abcde', 'abcde', 'abcde', 'abcde'] } }, { name: 'cy', picked: false }],
  turn: { seat: 1, placements: 0, allowed: 1, number: 1 },
  pool: [{ id: 7, c: 'ruby', v: 2 }],
  limits: { rounds: 3 },
  track: [[{ id: 9 }]],
  winners: [0, 2],
  ...extra,
});
const use = (v) => useTurnState(computed(() => v));

describe('useTurnState', () => {
  it('knows whose turn it is and whether a die may still be placed', () => {
    const t = use(view());
    expect(t.myTurn.value).toBe(true);
    expect(t.canPlace.value).toBe(true);
    expect(t.me.value.name).toBe('bob');
    expect(use(view({ turn: { seat: 0, placements: 0, allowed: 1 } })).myTurn.value).toBe(false);
    expect(use(view({ turn: { seat: 1, placements: 1, allowed: 1 } })).canPlace.value).toBe(false);
  });

  it('reports the phase and who is still choosing', () => {
    const t = use(view({ phase: 'windows' }));
    expect(t.windows.value).toBe(true);
    expect(t.myTurn.value).toBe(false);
    expect(t.waitingFor.value).toEqual(['bob', 'cy']);
    expect(use(view({ phase: 'finished' })).finished.value).toBe(true);
  });

  it('names seats, winners and pool dice, and lays out the round track', () => {
    const t = use(view());
    expect(t.nameOf(2)).toBe('cy');
    expect(t.nameOf(9)).toBe('Someone');
    expect(t.winners.value).toEqual(['ann', 'cy']);
    expect(t.poolDie(7).v).toBe(2);
    expect(t.poolDie(8)).toBeNull();
    expect(t.trackSlots.value).toEqual([[{ id: 9 }], null, null]);
    expect(t.pattern.value.cells).toHaveLength(20);
    expect(t.turnNumber.value).toBe('first');
    expect(t.poolMax.value).toBe(7);
  });
});
