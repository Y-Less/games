// The layout of the two Matrix rains, checked directly rather than by mounting a background and reading its text.
import { describe, expect, it } from 'vitest';
import { GLYPHS, rain, rainSliding } from './matrixRain.js';

const glyphs = new Set(GLYPHS);

describe('the Matrix rain', () => {
  it('lays out as many columns as it is asked for, and the same ones every time', () => {
    expect(rain(12, false)).toHaveLength(12);
    expect(rain(12, false)).toEqual(rain(12, false));
  });

  it('gives every column letters to show and a different letter for the head, one per row', () => {
    for (const column of rain(20, false)) {
      const rows = column.text.split('\n');
      expect(rows.length).toBe(column.lead.split('\n').length);
      expect(rows.every((ch) => glyphs.has(ch))).toBe(true);
      // The head shows its own glyph as it passes, rather than the one it leaves behind, so the two differ somewhere.
      expect(column.lead).not.toBe(column.text);
    }
  });

  it('keeps every column on the screen and within the row limit', () => {
    for (const column of rain(40, false)) {
      const rows = column.text.split('\n');
      expect(rows.length).toBeGreaterThanOrEqual(4);
      expect(rows.length).toBeLessThanOrEqual(120);
      expect(column.style['--t']).toBeLessThanOrEqual(rows.length); // the lit trail never outruns the column
      expect(parseFloat(column.style.left)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(column.style.left)).toBeLessThan(100);
    }
  });

  it('draws shorter columns in a shop preview than on the site', () => {
    const rowsOf = (columns) => columns.reduce((n, c) => n + c.text.split('\n').length, 0);
    expect(rowsOf(rain(9, true))).toBeLessThan(rowsOf(rain(9, false)));
  });
});

describe('the sliding Matrix rain', () => {
  it('lays out as many columns as it is asked for, and the same ones every time', () => {
    expect(rainSliding(12)).toHaveLength(12);
    expect(rainSliding(12)).toEqual(rainSliding(12));
  });

  it('brightens each column towards its head, and never past full', () => {
    for (const column of rainSliding(20)) {
      const alphas = column.letters.map((l) => Number(l.alpha));
      expect(alphas.every((a) => a > 0 && a <= 1)).toBe(true);
      expect(alphas.at(-1)).toBeGreaterThanOrEqual(alphas[0]); // the head is the brightest letter
      expect(column.letters.every((l) => glyphs.has(l.ch))).toBe(true);
    }
  });

  it('gives every column one of the six erase animations, and a band of the screen to fall through', () => {
    for (const column of rainSliding(30)) {
      expect(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']).toContain(column.fade);
      const top = parseFloat(column.wrap.top);
      const height = parseFloat(column.wrap.height);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(height).toBeGreaterThan(0);
      expect(top + height).toBeLessThanOrEqual(100.01); // it stops at the bottom of the screen, rounding aside
    }
  });

  it('is a different rain from the other one, not the same layout twice', () => {
    expect(rainSliding(12).map((c) => c.letters.length)).not.toEqual(rain(12, false).map((c) => c.text.split('\n').length));
  });
});
