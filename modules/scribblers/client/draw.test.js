// The drawing maths, on a buffer of pixels rather than a canvas: the palette, a stroke and a dot, and the flood fill.
import { describe, expect, it } from 'vitest';
import { PALETTE, WHITE, colourOf, floodFill, strokeInto } from './draw.js';

/** A small white board of pixels, shaped like the ImageData a canvas gives. */
function board(width = 40, height = 30) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, width, height };
}
/** The colour of one pixel, as [r, g, b]. */
const pixel = (image, x, y) => {
  const at = (y * image.width + x) * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2]];
};

describe('the palette', () => {
  it('has the twenty-six colours, white first and black in the middle', () => {
    expect(PALETTE).toHaveLength(26);
    expect(PALETTE[WHITE]).toBe('#ffffff');
    expect(PALETTE[13]).toBe('#000000');
  });

  it('gives each colour as red, green and blue', () => {
    expect(colourOf(WHITE)).toEqual({ r: 255, g: 255, b: 255 });
    expect(colourOf(13)).toEqual({ r: 0, g: 0, b: 0 });
    expect(colourOf(2)).toEqual({ r: 0xef, g: 0x13, b: 0x0b });
    expect(colourOf(999)).toEqual({ r: 0, g: 0, b: 0 }); // a colour that is not in the palette is drawn black
  });
});

describe('a stroke', () => {
  it('draws a line between its two ends and says what it touched', () => {
    const image = board();
    const touched = strokeInto(image, { t: 'line', x: 5, y: 15, x2: 30, y2: 15, c: 13, w: 8 });
    expect(pixel(image, 5, 15)).toEqual([0, 0, 0]);
    expect(pixel(image, 20, 15)).toEqual([0, 0, 0]);
    expect(pixel(image, 30, 15)).toEqual([0, 0, 0]);
    expect(pixel(image, 2, 2)).toEqual([255, 255, 255]);
    expect(touched).toMatchObject({ left: 0, top: 7, right: 38, bottom: 23 });
  });

  it('leaves a round dot when both ends are the same point', () => {
    const image = board();
    strokeInto(image, { t: 'line', x: 20, y: 15, x2: 20, y2: 15, c: 13, w: 16 });
    expect(pixel(image, 20, 15)).toEqual([0, 0, 0], 'the middle is filled');
    expect(pixel(image, 20, 9)).toEqual([0, 0, 0], 'and so is the edge of the circle');
    expect(pixel(image, 20, 1)).toEqual([255, 255, 255], 'but not beyond it');
  });

  it('draws the part of a stroke that is on the board and ignores the rest', () => {
    const image = board();
    expect(() => strokeInto(image, { t: 'line', x: -200, y: 15, x2: 20, y2: 15, c: 13, w: 8 })).not.toThrow();
    expect(pixel(image, 0, 15)).toEqual([0, 0, 0]);
    expect(pixel(image, 20, 15)).toEqual([0, 0, 0]);
  });

  it('paints with the colour it is given', () => {
    const image = board();
    strokeInto(image, { t: 'line', x: 10, y: 15, x2: 11, y2: 15, c: 2, w: 8 });
    // A stroke is drawn as the sweep of the brush's rim (as in scribble.rs), so the colour shows a brush-radius away
    // from where it was put down.
    expect(pixel(image, 10, 11)).toEqual([0xef, 0x13, 0x0b]);
  });
});

describe('the flood fill', () => {
  it('fills the area around a point and stops at a line', () => {
    const image = board();
    strokeInto(image, { t: 'line', x: 20, y: 0, x2: 20, y2: 29, c: 13, w: 8 }); // a wall down the middle
    expect(floodFill(image.data, 2, 2, colourOf(5), image.width, image.height)).toBe(true);
    expect(pixel(image, 2, 2)).toEqual([0, 0xcc, 0], 'the left side is filled');
    expect(pixel(image, 38, 2)).toEqual([255, 255, 255], 'the right side is not');
  });

  it('does nothing when the area is that colour already, or the point is off the board', () => {
    const image = board();
    expect(floodFill(image.data, 2, 2, colourOf(WHITE), image.width, image.height)).toBe(false);
    expect(floodFill(image.data, -1, 2, colourOf(5), image.width, image.height)).toBe(false);
    expect(floodFill(image.data, 0, 1000, colourOf(5), image.width, image.height)).toBe(false);
  });

  it('fills a whole blank board', () => {
    const image = board(20, 10);
    expect(floodFill(image.data, 0, 0, colourOf(13), image.width, image.height)).toBe(true);
    expect(pixel(image, 19, 9)).toEqual([0, 0, 0]);
  });
});
