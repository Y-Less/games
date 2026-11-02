// Tile colours: a distinct hue AND a distinct shape for each of the (up to eight) colours, so colour is never the only clue.
// Shapes are drawn in a 12 x 12 box.  TILE_COLOURS is indexed by a tile's colour number; the game's settings decide how many
// are used.  A colour's `key` is its name's key under `colours.` in the locale files (COLOUR_KEYS in ../rules.js), never a
// name: the name itself is looked up in the player's language.
import { COLOUR_KEYS } from '../rules.js';

export const TILE_COLOURS = [
  { key: COLOUR_KEYS[0], hue: '#cf3326', shape: 'circle' },
  { key: COLOUR_KEYS[1], hue: '#1f62d1', shape: 'triangle' },
  { key: COLOUR_KEYS[2], hue: '#d97a06', shape: 'square' },
  { key: COLOUR_KEYS[3], hue: '#23232b', shape: 'diamond' },
  { key: COLOUR_KEYS[4], hue: '#1f8f48', shape: 'star' },
  { key: COLOUR_KEYS[5], hue: '#7e3fc2', shape: 'cross' },
  { key: COLOUR_KEYS[6], hue: '#0e8f9b', shape: 'pentagon' },
  { key: COLOUR_KEYS[7], hue: '#d63f93', shape: 'hexagon' },
];

// The outline of each shape named in TILE_COLOURS, in the 12 x 12 box: a circle as [cx, cy, r], a rectangle as [x, y, width,
// height] and everything else as an SVG `points` string.  Tile.vue draws these.
export const SHAPES = {
  circle: { circle: [6, 6, 5] },
  triangle: { points: '6,0.8 11.4,11 0.6,11' },
  square: { rect: [1.2, 1.2, 9.6, 9.6] },
  diamond: { points: '6,0.4 11.6,6 6,11.6 0.4,6' },
  star: { points: '6,0.5 7.6,4.2 11.5,4.5 8.5,7.1 9.4,11 6,8.9 2.6,11 3.5,7.1 0.5,4.5 4.4,4.2' },
  cross: { points: '4.2,0.6 7.8,0.6 7.8,4.2 11.4,4.2 11.4,7.8 7.8,7.8 7.8,11.4 4.2,11.4 4.2,7.8 0.6,7.8 0.6,4.2 4.2,4.2' },
  pentagon: { points: '6,0.5 11.4,4.4 9.3,11 2.7,11 0.6,4.4' },
  hexagon: { points: '3.2,1 8.8,1 11.5,6 8.8,11 3.2,11 0.5,6' },
};

/**
 * Looks up a colour's name key, hue, and shape.
 *
 * @param {number} colour  a colour index (falls back to the first colour, red, if it is out of range)
 * @returns {{key: string, hue: string, shape: string}} the colour's entry in TILE_COLOURS
 *
 * Side effects: none.
 */
export const colourInfo = (colour) => TILE_COLOURS[colour] ?? TILE_COLOURS[0];
