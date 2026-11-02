// Tile.vue's colour table: the look of the five tiles and the first-player marker (colours chosen for contrast; the
// pattern on each tile does the rest).  Also holds the floor penalty labels.

/**
 * Colour palette per tile colour index; key -1 is the first-player marker.
 * @type {Record<number, {base: string, dark: string, accent: string}>}  base = fill, dark = outline, accent = pattern.
 * Side effects: none.
 */
export const TILE_STYLE = {
  [-1]: { base: '#e0a84a', dark: '#4a3207', accent: '#fff3d0' },
  0: { base: '#2f5fb3', dark: '#173570', accent: '#d3e3ff' },
  1: { base: '#e3a41f', dark: '#7d5304', accent: '#fff2bd' },
  2: { base: '#c4573a', dark: '#702a17', accent: '#ffdccb' },
  3: { base: '#2c9a82', dark: '#14564a', accent: '#cdf4e8' },
  4: { base: '#7d4b9b', dark: '#46245c', accent: '#f0daf9' },
};
/**
 * The penalty shown above each of the seven floor-line slots, in order (cumulative penalty rules: 1, 1, 2, 2, 2, 3, 3).
 * @type {string[]}
 * Side effects: none.
 */
export const PENALTY_LABEL = ['-1', '-1', '-2', '-2', '-2', '-3', '-3'];
