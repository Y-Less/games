// Drawing data shared by the dice and the window spaces: colours, the shape that marks each colour (so colour is never
// the only clue) and where the pips go. Everything is drawn in a 40 x 40 box.
export const COLOUR_HEX = { ruby: '#cf3f56', topaz: '#e6b422', jade: '#2f9e63', sapphire: '#3b78d6', amethyst: '#9457c9' };
export const COLOUR_INK = { ruby: '#fff7f0', topaz: '#2a1c05', jade: '#f2fff6', sapphire: '#f2f7ff', amethyst: '#fbf4ff' };
export const COLOUR_LABEL = { ruby: 'Ruby', topaz: 'Topaz', jade: 'Jade', sapphire: 'Sapphire', amethyst: 'Amethyst' };
export const SHAPE_OF = { ruby: 'diamond', topaz: 'circle', jade: 'triangle', sapphire: 'square', amethyst: 'star' };
export const SHAPES = {
  diamond: 'M20 4 L35 20 L20 36 L5 20 Z',
  circle: 'M20 5 a15 15 0 1 0 0.01 0 Z',
  triangle: 'M20 5 L36 34 L4 34 Z',
  square: 'M7 7 H33 V33 H7 Z',
  star: 'M20 3.5 L24.6 14.6 L36.5 15.6 L27.4 23.4 L30.2 35 L20 28.8 L9.8 35 L12.6 23.4 L3.5 15.6 L15.4 14.6 Z',
};
export const PIPS = {
  1: [[20, 20]],
  2: [[12, 12], [28, 28]],
  3: [[11, 11], [20, 20], [29, 29]],
  4: [[12, 12], [28, 12], [12, 28], [28, 28]],
  5: [[11, 11], [29, 11], [20, 20], [11, 29], [29, 29]],
  6: [[12, 10.5], [28, 10.5], [12, 20], [28, 20], [12, 29.5], [28, 29.5]],
};
export const colourOfLetter = { R: 'ruby', T: 'topaz', J: 'jade', S: 'sapphire', A: 'amethyst' };
