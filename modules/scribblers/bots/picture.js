// Turning a word into something to draw: the first image a search finds for it, brought down to a small square of
// palette colours, and then into drawing instructions for the board.
//
// This is for the stand-alone bot (bot.js), so that there is something to play against while the game is being worked
// on.  Nothing here runs on the site: the site's computer players draw nothing.
//
//   word -> searchImage  -> a picture's URL (Wikimedia Commons, which needs no key)
//        -> loadPicture  -> its pixels (PNG and JPEG are understood)
//        -> squareOf     -> a 256 x 256 square of them, as the game asks for
//        -> instructions -> lines for the board, one per run of neighbouring blocks of the same colour
//
// **Why runs rather than one instruction per pixel.**  The board is 1600 x 900 units and its thinnest brush is 8 of
// them, so a block of the picture cannot be smaller than that: 112 of them fill the board's height.  The 256 x 256
// square is therefore sampled into a grid of blocks, and neighbouring blocks of the same colour become one line each,
// which is the same picture in a few thousand instructions instead of sixty-five thousand.  A block on its own is
// still an instruction of its own.
//
// The rows are drawn closer together than the brush is wide, because the brush is round: left a brush-width apart, the
// circles only touch, and the white board shows through between them.
//
// Depends on: jpeg-js and pngjs (both dev dependencies: the site never loads this), and ../drawing.js (the palette and
// the board's size).  `fetch` and the decoders are injectable, so the tests need no network and no pictures.
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { BOARD, BRUSH, PALETTE } from '../drawing.js';

/** How big the picture is made before it is drawn, as the game asks: 256 x 256. */
export const SQUARE = 256;
/** How wide a block is, in board units: the thinnest brush there is, since nothing finer can be drawn. */
export const BLOCK = BRUSH.min;
/** How far apart the rows are: less than the brush is wide, so that the round strokes overlap and leave no white between them. */
export const ROW_STEP = 6;
/** The side of the square the picture is drawn in, in board units: as much of the board's height as whole blocks fill. */
export const SIDE = Math.floor(BOARD.height / BLOCK) * BLOCK;
/** How many blocks across, and how many rows down, the picture is drawn in. */
export const COLUMNS = SIDE / BLOCK;
export const ROWS = Math.floor((SIDE - BLOCK) / ROW_STEP) + 1;
/** Where the picture is put on the board: a square, in the middle. */
export const ORIGIN = { x: Math.round((BOARD.width - SIDE) / 2), y: Math.round((BOARD.height - SIDE) / 2) };

/** Where the pictures come from: a search that needs no key, and gives a thumbnail rather than a ten-megabyte original. */
const SEARCH = 'https://commons.wikimedia.org/w/api.php';
/** What to say we are, since Wikimedia asks callers to say (and refuses the ones that do not). */
const AGENT = 'scribblers-bot/1.0 (a game hub test bot; https://github.com/scribble-rs/scribble.rs)';

/** The palette as red, green and blue, worked out once. */
const PALETTE_RGB = PALETTE.map((hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }));

/**
 * The place in the palette closest to a colour (by plain distance in red, green and blue: near enough for a drawing).
 *
 * @param {number} r  @param {number} g  @param {number} b  the colour, 0 to 255
 * @returns {number} the palette index
 * Side effects: none.
 */
export function nearestColour(r, g, b) {
  let best = 0;
  let distance = Infinity;
  for (const [index, colour] of PALETTE_RGB.entries()) {
    const away = (colour.r - r) ** 2 + (colour.g - g) ** 2 + (colour.b - b) ** 2;
    if (away < distance) {
      distance = away;
      best = index;
    }
  }
  return best;
}

/**
 * The first image a search for this word finds.
 *
 * @param {string} word  the word being drawn
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]  how to fetch (the tests pass their own)
 * @param {number} [options.width]  how wide a thumbnail to ask for
 * @returns {Promise<string | null>} the picture's URL, or null if the search found nothing usable
 * Side effects: one HTTP request.
 */
export async function searchImage(word, { fetchImpl = fetch, width = 512 } = {}) {
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${word} filetype:bitmap`,
    gsrnamespace: '6', // files
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url|mime',
    iiurlwidth: String(width),
  });
  const response = await fetchImpl(`${SEARCH}?${query}`, { headers: { 'user-agent': AGENT, accept: 'application/json' } });
  if (!response.ok) return null;
  const body = await response.json();
  const pages = Object.values(body?.query?.pages ?? {});
  // `index` is the order the search put them in; the object they arrive in has no order of its own.
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info) continue;
    if (!['image/png', 'image/jpeg'].includes(info.thumbmime ?? info.mime)) continue;
    const url = info.thumburl ?? info.url;
    if (typeof url === 'string') return url;
  }
  return null;
}

/**
 * Reads a picture's pixels.  PNG and JPEG are told apart by what they begin with, not by what the server called them.
 *
 * @param {ArrayBuffer | Buffer | Uint8Array} bytes  the file
 * @returns {{ width: number, height: number, data: Uint8Array }} the pixels, four bytes each (red, green, blue, alpha)
 * Side effects: none.
 */
export function decodePicture(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const image = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 128 });
    return { width: image.width, height: image.height, data: image.data };
  }
  throw new Error('that is not a PNG or a JPEG');
}

/**
 * Downloads a picture and reads its pixels.
 *
 * @param {string} url  where it is
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]  how to fetch
 * @returns {Promise<{ width: number, height: number, data: Uint8Array }>} the pixels
 * Side effects: one HTTP request.
 */
export async function loadPicture(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: { 'user-agent': AGENT } });
  if (!response.ok) throw new Error(`the picture could not be fetched (${response.status})`);
  return decodePicture(await response.arrayBuffer());
}

/**
 * Brings a picture down to a square of the given size, keeping its middle: the longer side is cropped so that nothing
 * is squashed, and each square of the result is the average of the pixels under it.  Anything see-through counts as
 * white, which is what the board starts as.
 *
 * @param {{ width: number, height: number, data: Uint8Array }} picture  the pixels
 * @param {number} [size]  the side of the square to make
 * @returns {{ size: number, data: Uint8Array }} `data` is three bytes per square (red, green, blue)
 * Side effects: none.
 */
export function squareOf(picture, size = SQUARE) {
  const side = Math.min(picture.width, picture.height);
  const offsetX = Math.floor((picture.width - side) / 2);
  const offsetY = Math.floor((picture.height - side) / 2);
  const data = new Uint8Array(size * size * 3);
  const step = side / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fromX = offsetX + Math.floor(x * step);
      const toX = offsetX + Math.max(Math.floor((x + 1) * step), Math.floor(x * step) + 1);
      const fromY = offsetY + Math.floor(y * step);
      const toY = offsetY + Math.max(Math.floor((y + 1) * step), Math.floor(y * step) + 1);
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sy = fromY; sy < toY; sy++) {
        for (let sx = fromX; sx < toX; sx++) {
          const at = (sy * picture.width + sx) * 4;
          const alpha = picture.data[at + 3] / 255;
          red += picture.data[at] * alpha + 255 * (1 - alpha);
          green += picture.data[at + 1] * alpha + 255 * (1 - alpha);
          blue += picture.data[at + 2] * alpha + 255 * (1 - alpha);
          count++;
        }
      }
      const at = (y * size + x) * 3;
      data[at] = Math.round(red / count);
      data[at + 1] = Math.round(green / count);
      data[at + 2] = Math.round(blue / count);
    }
  }
  return { size, data };
}

/**
 * The drawing instructions for a square picture: it is sampled into a grid of palette colours, and each run of
 * neighbouring blocks of the same colour becomes one line.  White is left out, because the board is white already -
 * which is also what keeps the instruction count down.
 *
 * @param {{ size: number, data: Uint8Array }} square  from squareOf
 * @returns {object[]} the instructions, top row first
 * Side effects: none.
 */
export function instructions(square) {
  const ops = [];
  const across = square.size / COLUMNS;
  const down = square.size / ROWS;
  for (let row = 0; row < ROWS; row++) {
    const y = ORIGIN.y + row * ROW_STEP + Math.floor(BLOCK / 2);
    let runColour = -1;
    let runFrom = 0;
    /** Closes the run that ends before `column`, putting a line on the board unless it is white. */
    const close = (column) => {
      if (runColour > 0) {
        ops.push({
          t: 'line',
          x: ORIGIN.x + runFrom * BLOCK + Math.floor(BLOCK / 2),
          y,
          x2: ORIGIN.x + (column - 1) * BLOCK + Math.floor(BLOCK / 2),
          y2: y,
          c: runColour,
          w: BLOCK,
        });
      }
      runColour = -1;
    };
    for (let column = 0; column < COLUMNS; column++) {
      const at = (Math.floor(row * down) * square.size + Math.floor(column * across)) * 3;
      const colour = nearestColour(square.data[at], square.data[at + 1], square.data[at + 2]);
      if (colour !== runColour) {
        close(column);
        runColour = colour;
        runFrom = column;
      }
    }
    close(COLUMNS);
  }
  return ops;
}

/**
 * Everything at once: a word in, drawing instructions out.
 *
 * @param {string} word  the word to draw
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]  how to fetch (both the search and the picture)
 * @returns {Promise<{ ops: object[], url: string | null }>} the instructions and where the picture came from (no
 *   instructions when the search found nothing)
 * Side effects: two HTTP requests.
 */
export async function drawingFor(word, { fetchImpl = fetch } = {}) {
  const url = await searchImage(word, { fetchImpl });
  if (!url) return { ops: [], url: null };
  const picture = await loadPicture(url, { fetchImpl });
  return { ops: instructions(squareOf(picture)), url };
}
