// The dial's geometry, the layout sums and the "Recent moves" of Wavelength.
import { describe, expect, it } from 'vitest';
import { VIEW, angleOf, pointAt, positionAt, targetWedges, wedgePath } from './dial.js';
import { NARROW, dialSpan, dialWidth } from './layout.js';
import { newEntries } from './moveLog.js';

describe('dial geometry', () => {
  it('puts 0 on the left, 100 on the right and 50 straight up', () => {
    expect(pointAt(0).x).toBeCloseTo(VIEW.cx - VIEW.radius);
    expect(pointAt(100).x).toBeCloseTo(VIEW.cx + VIEW.radius);
    expect(pointAt(50).x).toBeCloseTo(VIEW.cx);
    expect(pointAt(50).y).toBeCloseTo(VIEW.cy - VIEW.radius);
    expect(angleOf(0)).toBeCloseTo(Math.PI);
    expect(angleOf(150)).toBeCloseTo(0);
  });

  it('turns a point back into a position, and snaps to the nearer end below the centre', () => {
    for (const p of [0, 12.5, 50, 73.4, 100]) {
      const point = pointAt(p, 60);
      expect(positionAt(point.x, point.y)).toBeCloseTo(p, 0);
    }
    expect(positionAt(VIEW.cx - 30, VIEW.cy + 20)).toBe(0);
    expect(positionAt(VIEW.cx + 30, VIEW.cy + 20)).toBe(100);
  });

  it('draws the bands widest first and keeps them on the dial', () => {
    const bands = [{ within: 2.5, points: 4 }, { within: 12.5, points: 2 }, { within: 7.5, points: 3 }];
    const wedges = targetWedges(50, bands);
    expect(wedges.map((w) => w.points)).toEqual([2, 3, 4]);
    expect(wedges[0]).toEqual({ points: 2, from: 37.5, to: 62.5 });
    expect(targetWedges(5, bands)[0].from).toBe(0);
    expect(wedgePath(10, 20)).toMatch(/^M 110 112 L [\d.]+ [\d.]+ A 100 100 0 0 1 [\d.]+ [\d.]+ Z$/);
  });
});

describe('layout', () => {
  const area = (width) => ({ width, height: 400, columns: 12, gap: 12 });
  it('stacks the clue panel under the dial on a narrow screen', () => {
    expect(dialSpan(area(NARROW - 1))).toBe(12);
    expect(dialSpan(area(NARROW))).toBe(8);
  });
  it('sizes the dial by the room it has, never beyond its column or below a usable size', () => {
    expect(dialWidth(900, 400)).toBeLessThanOrEqual(900);
    expect(dialWidth(300, 800)).toBe(300);
    expect(dialWidth(900, 100)).toBe(180);
    expect(dialWidth(900, 500, true)).toBeLessThan(dialWidth(900, 500, false));
  });
});

describe('recent moves', () => {
  const players = (extra = {}) => [
    { id: 1, name: 'Ann', guessed: false, ...extra },
    { id: 2, name: 'Bob', guessed: false },
  ];
  const state = (over) => ({ phase: 'clue', turn: 1, turnsTotal: 4, psychic: 1, clue: '', spectrum: { left: 'Cold', right: 'Hot' }, players: players(), ...over });

  it('announces a turn once, then the clue, the guesses and the result', () => {
    const first = state();
    expect(newEntries(null, first)).toEqual(['Turn 1 of 4: Ann is the psychic, between Cold and Hot.']);
    expect(newEntries(first, state())).toEqual([]);
    const clued = state({ phase: 'guessing', clue: 'a hot bath' });
    expect(newEntries(first, clued)).toEqual(['Ann gave the clue “a hot bath”.']);
    const guessed = { ...clued, players: [players()[0], { ...players()[1], guessed: true }] };
    expect(newEntries(clued, guessed)).toEqual(['Bob guessed.']);
    const revealed = { ...guessed, phase: 'reveal', result: { psychicName: 'Ann', psychicPoints: 3, entries: [{ name: 'Bob', points: 4, bullseye: true }] } };
    expect(newEntries(guessed, revealed)).toEqual(['Bob hit the bullseye (+4).', 'The target is revealed. Ann scores 3 for the clue.']);
  });

  it('describes a team lock-in as one line', () => {
    const guessing = state({ phase: 'guessing', clue: 'x', mode: 'team' });
    const revealed = { ...guessing, phase: 'reveal', result: { team: true, lockedBy: 2, psychicName: 'Ann', psychicPoints: 3, entries: [{ name: 'Bob', points: 3 }] } };
    expect(newEntries(guessing, revealed)).toEqual(['Bob locked in the marker for the team (+3 for everyone).', 'The target is revealed. Ann scores 3 for the clue.']);
  });

  it('says who won and notes an abandoned game', () => {
    const done = state({ phase: 'finished', players: players({ winner: true }) });
    expect(newEntries(state({ phase: 'reveal' }), done)).toEqual(['The game is over: Ann wins.']);
    expect(newEntries(state(), state({ phase: 'abandoned' }))).toEqual(['The game was abandoned.']);
    expect(newEntries(null, { phase: 'lobby' })).toEqual([]);
  });
});
