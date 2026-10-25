// Tile colours: a distinct hue AND a distinct shape for each of the (up to eight) colours, so colour is never the only clue.
// Shapes are drawn in a 12 x 12 box.
export const TILE_COLOURS = [
  { name: 'Red', hue: '#cf3326', shape: 'circle' },
  { name: 'Blue', hue: '#1f62d1', shape: 'triangle' },
  { name: 'Orange', hue: '#d97a06', shape: 'square' },
  { name: 'Black', hue: '#23232b', shape: 'diamond' },
  { name: 'Green', hue: '#1f8f48', shape: 'star' },
  { name: 'Purple', hue: '#7e3fc2', shape: 'cross' },
  { name: 'Teal', hue: '#0e8f9b', shape: 'pentagon' },
  { name: 'Pink', hue: '#d63f93', shape: 'hexagon' },
];

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

export const colourInfo = (colour) => TILE_COLOURS[colour] ?? TILE_COLOURS[0];
