import { describe, expect, it } from 'vitest';
import { SEAT_COLOURS, seatColour } from './colours.js';

describe('cribbage seat colours', () => {
  it('has four distinct hex colours', () => {
    expect(SEAT_COLOURS).toHaveLength(4);
    expect(new Set(SEAT_COLOURS).size).toBe(4);
    for (const colour of SEAT_COLOURS) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives each seat its own colour', () => {
    expect([0, 1, 2, 3].map(seatColour)).toEqual(SEAT_COLOURS);
  });

  it('wraps round for seats beyond the fourth', () => {
    expect(seatColour(4)).toBe(SEAT_COLOURS[0]);
    expect(seatColour(7)).toBe(SEAT_COLOURS[3]);
  });
});
