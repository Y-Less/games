import { describe, expect, it } from 'vitest';
import { SEAT_COLOURS, seatColour } from './colours.js';

describe('cribbage seat colours', () => {
  it('has five distinct hex colours', () => {
    expect(SEAT_COLOURS).toHaveLength(5);
    expect(new Set(SEAT_COLOURS).size).toBe(5);
    for (const colour of SEAT_COLOURS) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives each seat its own colour', () => {
    expect([0, 1, 2, 3, 4].map(seatColour)).toEqual(SEAT_COLOURS);
  });

  it('wraps round for seats beyond the fifth', () => {
    expect(seatColour(5)).toBe(SEAT_COLOURS[0]);
    expect(seatColour(8)).toBe(SEAT_COLOURS[3]);
  });
});
