// Putting the drawing instructions on a canvas: the palette, lines with a round brush, and the flood fill.
//
// This is a port of scribble.rs's resources/draw.js (BSD 3-Clause), whose flood fill in turn came from
// github.com/binarymax/floodfill.js (MIT, Max Irwin, 2011-2016).  See ../README.md.
//
// Why it works on an ImageData buffer rather than the canvas's own drawing calls: what goes into a canvas is not always
// what comes out of it again (some browsers alter a pixel or two when a page reads a canvas back, to spoil
// fingerprinting), and a flood fill reads the pixels back.  So the buffer is the truth and the canvas is only shown.
// Depends on: nothing (a browser's ImageData and CanvasRenderingContext2D are enough).

/** The colours a drawing may use, in the order the toolbox shows them; an instruction names one by its place here. */
export const PALETTE = [
  '#ffffff',
  '#c1c1c1',
  '#ef130b',
  '#ff7100',
  '#ffe400',
  '#00cc00',
  '#00b2ff',
  '#231fd3',
  '#a300ba',
  '#d37caa',
  '#a0522d',
  '#592f2a',
  '#ecbcb4',
  '#000000',
  '#4c4c4c',
  '#740b07',
  '#c23800',
  '#e8a200',
  '#005510',
  '#00569e',
  '#0e0865',
  '#550069',
  '#a75574',
  '#63300d',
  '#492f31',
  '#d1a3a4',
];

/** White: what the board starts as, and what the rubber draws with. */
export const WHITE = 0;

/**
 * A palette colour as red, green and blue.
 * @param {number} index  a place in PALETTE
 * @returns {{ r: number, g: number, b: number }} the colour (black for anything that is not a colour of the palette)
 * Side effects: none.
 */
export function rgbOf(index) {
  const hex = PALETTE[index] ?? '#000000';
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

const rgbCache = PALETTE.map((hex, index) => rgbOf(index));

/**
 * A palette colour as red, green and blue, worked out once and kept.
 * @param {number} index  a place in PALETTE
 * @returns {{ r: number, g: number, b: number }}
 * Side effects: none.
 */
export const colourOf = (index) => rgbCache[index] ?? rgbCache[13];

/**
 * Whether the pixel at this offset is the colour we are replacing.
 * @param {Uint8ClampedArray} data  the pixels
 * @param {number} at  the offset of the pixel's red channel
 * @param {number[]} target  [r, g, b] being replaced
 * @returns {boolean}
 * Side effects: none.
 */
const samePixel = (data, at, target) => target[0] === data[at] && target[1] === data[at + 1] && target[2] === data[at + 2];

/**
 * Paints the pixel at this offset if it is the colour being replaced.
 * @param {Uint8ClampedArray} data  the pixels (mutated)
 * @param {number} at  the offset of the pixel's red channel
 * @param {number[]} target  [r, g, b] being replaced
 * @param {{ r: number, g: number, b: number }} fill  the new colour
 * @returns {boolean} true if the pixel was painted
 * Side effects: writes three bytes of `data`.
 */
function paintPixel(data, at, target, fill) {
  if (!samePixel(data, at, target)) return false;
  data[at] = fill.r;
  data[at + 1] = fill.g;
  data[at + 2] = fill.b;
  return true;
}

/**
 * Fills the area of one colour around a point, as a paint bucket does: a scanline flood fill.
 *
 * @param {Uint8ClampedArray} data  the pixels (mutated)
 * @param {number} x  where it was clicked, in board units
 * @param {number} y  likewise
 * @param {{ r: number, g: number, b: number }} fill  the colour to fill with
 * @param {number} width  the board's width in pixels
 * @param {number} height  the board's height in pixels
 * @returns {boolean} true if anything changed (filling with the colour already there changes nothing)
 * Side effects: writes to `data`.
 */
export function floodFill(data, x, y, fill, width, height) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  // Both have to be checked, not just the offset they make: (-1, 2) would otherwise land at the end of the line above.
  if (left < 0 || top < 0 || left >= width || top >= height) return false;
  const start = (left + top * width) * 4;
  if (start >= data.length) return false;
  const target = [data[start], data[start + 1], data[start + 2]];
  if (target[0] === fill.r && target[1] === fill.g && target[2] === fill.b) return false;

  const row = width * 4;
  // The queue is made at the size of the board to begin with, since growing it as it went cost more than the room
  // does; a span reached from both sides can still push one place more, so it is an ordinary array and may grow.
  const queue = new Array(width * height);
  let next = 0;
  queue[next++] = start;

  while (next > 0) {
    const at = queue[--next];
    if (!paintPixel(data, at, target, fill)) continue;
    const left = Math.floor(at / row) * row; // the first pixel of this line
    const right = left + row; // one past the last
    let west = at;
    let east = at;
    while (left < west && left <= (west -= 4) && paintPixel(data, west, target, fill));
    while (right > east && right > (east += 4) && paintPixel(data, east, target, fill));
    for (let span = west + 4; span < east; span += 4) {
      if (span - row >= 0 && samePixel(data, span - row, target)) queue[next++] = span - row;
      if (span + row < data.length && samePixel(data, span + row, target)) queue[next++] = span + row;
    }
  }
  return true;
}

// A round brush of each size, worked out once: 1 for the rim of the circle and 2 for the inside, as scribble.rs has it,
// so that a stroke of no length (a dot) fills the whole circle while a stroke only needs its rim.
const brushes = new Map();

/**
 * The shape of the brush of a given width: which offsets from the centre it covers.
 * @param {number} radius  half the brush width, rounded down
 * @returns {number[][]} `shape[x][y]`: 0 outside the circle, 1 on its rim, 2 inside it
 * Side effects: fills a cache the first time each radius is asked for.
 */
function brush(radius) {
  const cached = brushes.get(radius);
  if (cached) return cached;
  const size = 2 * radius;
  const shape = [];
  for (let x = 0; x < size; x++) {
    shape.push([]);
    for (let y = 0; y < size; y++) {
      const distance = Math.sqrt((radius - x) ** 2 + (radius - y) ** 2);
      shape[x].push(distance > radius ? 0 : distance < radius - 2 ? 2 : 1);
    }
  }
  brushes.set(radius, shape);
  return shape;
}

/**
 * Draws a one-pixel line between two points (Bresenham), skipping anything off the board.
 * @param {ImageData} image  the pixels (mutated)
 * @param {number} x1  @param {number} y1  @param {number} x2  @param {number} y2  the ends, in board units
 * @param {{ r: number, g: number, b: number }} colour  the colour
 * @returns {void}
 * Side effects: writes to `image.data`.
 */
function bresenham(image, x1, y1, x2, y2, colour) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const stepX = x1 < x2 ? 1 : -1;
  const stepY = y1 < y2 ? 1 : -1;
  let error = dx - dy;
  let x = x1;
  let y = y1;
  for (;;) {
    if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
      const at = (y * image.width + x) * 4;
      image.data[at] = colour.r;
      image.data[at + 1] = colour.g;
      image.data[at + 2] = colour.b;
    }
    if (x === x2 && y === y2) return;
    const doubled = 2 * error;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
  }
}

/**
 * The part of the board a stroke can have touched, so that only that much of it need be shown again.
 * @param {ImageData} image  the pixels, for the board's size
 * @param {number} x1  @param {number} y1  @param {number} x2  @param {number} y2  the ends
 * @param {number} width  the brush width
 * @returns {{ left: number, top: number, right: number, bottom: number }} in board units, inside the board
 * Side effects: none.
 */
function touched(image, x1, y1, x2, y2, width) {
  const inside = (n, most) => Math.max(0, Math.min(most, n));
  return {
    left: inside(Math.min(x1, x2) - width, image.width),
    top: inside(Math.min(y1, y2) - width, image.height),
    right: inside(Math.max(x1, x2) + width, image.width),
    bottom: inside(Math.max(y1, y2) + width, image.height),
  };
}

/**
 * Draws one stroke into the pixels, without showing it yet.
 * @param {ImageData} image  the pixels (mutated)
 * @param {object} op  a line instruction { x, y, x2, y2, c, w }
 * @returns {{ left: number, top: number, right: number, bottom: number }} the part of the board it touched
 * Side effects: writes to `image.data`.
 */
export function strokeInto(image, op) {
  const x1 = Math.floor(op.x);
  const y1 = Math.floor(op.y);
  const x2 = Math.floor(op.x2);
  const y2 = Math.floor(op.y2);
  const colour = colourOf(op.c);
  const shape = brush(Math.floor(op.w / 2));
  const middle = Math.floor(shape.length / 2);
  const dot = x1 === x2 && y1 === y2;
  for (let sx = 0; sx < shape.length; sx++) {
    for (let sy = 0; sy < shape[sx].length; sy++) {
      if (shape[sx][sy] === 1 || (dot && shape[sx][sy] === 2)) {
        bresenham(image, x1 + sx - middle, y1 + sy - middle, x2 + sx - middle, y2 + sy - middle, colour);
      }
    }
  }
  return touched(image, x1, y1, x2, y2, op.w);
}

/**
 * Draws one instruction and shows it.
 * @param {CanvasRenderingContext2D} context  the canvas
 * @param {ImageData} image  the pixels (mutated)
 * @param {object} op  a line or fill instruction
 * @returns {void}
 * Side effects: writes to `image.data` and puts the changed part on the canvas.
 */
export function applyOp(context, image, op) {
  if (op.t === 'fill') {
    if (floodFill(image.data, op.x, op.y, colourOf(op.c), image.width, image.height)) context.putImageData(image, 0, 0);
    return;
  }
  const { left, top, right, bottom } = strokeInto(image, op);
  if (right > left && bottom > top) context.putImageData(image, 0, 0, left, top, right - left, bottom - top);
}

/**
 * Draws a list of instructions and shows the result once at the end (much faster than one at a time).
 * @param {CanvasRenderingContext2D} context  the canvas
 * @param {ImageData} image  the pixels (mutated)
 * @param {object[]} ops  the instructions
 * @returns {void}
 * Side effects: writes to `image.data` and puts the whole board on the canvas.
 */
export function applyOps(context, image, ops) {
  for (const op of ops) {
    if (op.t === 'fill') floodFill(image.data, op.x, op.y, colourOf(op.c), image.width, image.height);
    else strokeInto(image, op);
  }
  context.putImageData(image, 0, 0);
}

/**
 * Makes the board blank (white) and hands back the pixels to work on.
 * @param {CanvasRenderingContext2D} context  the canvas
 * @returns {ImageData} the blank pixels
 * Side effects: fills the canvas white and reads it back.
 */
export function blankBoard(context) {
  context.fillStyle = PALETTE[WHITE];
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  return context.getImageData(0, 0, context.canvas.width, context.canvas.height);
}
