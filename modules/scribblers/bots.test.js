// The stand-alone bot's two halves, without a network and without the site: turning a picture into strokes the board
// will accept, and choosing a guess from what the hints give away.  (bots/bot.js itself is the plumbing around these:
// it signs in, joins, and sends what they return.)
import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { BLOCK, COLUMNS, ORIGIN, ROWS, SQUARE, decodePicture, drawingFor, instructions, nearestColour, searchImage, squareOf } from './bots/picture.js';
import { pickGuess, wordsThatFit } from './bots/guessing.js';
import { BOARD, PALETTE, readOp } from './drawing.js';
import { wordList } from './words.js';

/**
 * A picture of flat colours: `colourAt(x, y)` gives each pixel as [r, g, b] (or [r, g, b, a]).
 * @param {number} width  @param {number} height  @param {(x: number, y: number) => number[]} colourAt
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function picture(width, height, colourAt) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = colourAt(x, y);
      const at = (y * width + x) * 4;
      data.set([r, g, b, a], at);
    }
  }
  return { width, height, data };
}

/** The same picture as a PNG file. */
function asPng(image) {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}
/** The same picture as a JPEG file. */
const asJpeg = (image) => jpeg.encode({ data: Buffer.from(image.data), width: image.width, height: image.height }, 95).data;

/** A `fetch` that answers from a table of URL patterns: a string is JSON, a Buffer is a file. */
function fakeFetch(answers) {
  return async (url) => {
    for (const [pattern, answer] of answers) {
      if (!url.includes(pattern)) continue;
      if (answer === null) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      const body = typeof answer === 'string' ? answer : null;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(body),
        arrayBuffer: async () => (body === null ? answer.buffer.slice(answer.byteOffset, answer.byteOffset + answer.byteLength) : new ArrayBuffer(0)),
      };
    }
    throw new Error(`nothing fetched for ${url}`);
  };
}

test('a colour is matched to the nearest one in the palette', () => {
  assert.equal(nearestColour(255, 255, 255), 0, 'white');
  assert.equal(nearestColour(0, 0, 0), 13, 'black');
  assert.equal(PALETTE[nearestColour(0xef, 0x13, 0x0b)], '#ef130b', 'a colour of the palette is itself');
  assert.equal(PALETTE[nearestColour(0xf0, 0x20, 0x10)], '#ef130b', 'and so is one near it');
  assert.ok(nearestColour(250, 250, 250) === 0 || PALETTE[nearestColour(250, 250, 250)] === '#c1c1c1');
});

test('a PNG and a JPEG are both read, and anything else is refused', () => {
  const image = picture(4, 4, (x) => (x < 2 ? [255, 0, 0] : [0, 0, 255]));
  const fromPng = decodePicture(asPng(image));
  assert.deepEqual([fromPng.width, fromPng.height], [4, 4]);
  assert.deepEqual([...fromPng.data.slice(0, 3)], [255, 0, 0]);
  const fromJpeg = decodePicture(asJpeg(picture(16, 16, () => [255, 0, 0])));
  assert.deepEqual([fromJpeg.width, fromJpeg.height], [16, 16]);
  assert.ok(fromJpeg.data[0] > 200 && fromJpeg.data[1] < 60, 'a red picture comes back red');
  assert.throws(() => decodePicture(Buffer.from('not a picture at all')), /PNG or a JPEG/);
});

test('a picture is brought down to a square of the size the game asks for, keeping its middle', () => {
  // A wide picture: red on the left third, green in the middle, blue on the right.  Cropping to a square keeps green.
  const wide = picture(300, 100, (x) => (x < 100 ? [255, 0, 0] : x < 200 ? [0, 255, 0] : [0, 0, 255]));
  const square = squareOf(wide, 8);
  assert.equal(square.size, 8);
  assert.equal(square.data.length, 8 * 8 * 3);
  for (let n = 0; n < 8 * 8; n++) {
    assert.deepEqual([...square.data.slice(n * 3, n * 3 + 3)], [0, 255, 0], `square ${n} is the middle of the picture`);
  }
});

test('what can be seen through is drawn as white, because that is what the board starts as', () => {
  const clear = picture(4, 4, () => [0, 0, 0, 0]);
  const square = squareOf(clear, 2);
  assert.deepEqual([...square.data.slice(0, 3)], [255, 255, 255]);
});

test('the instructions paint the picture in rows of runs, and the board would accept every one', () => {
  // Two bands: red above, blue below.  Each row should be one run across.
  const square = squareOf(
    picture(64, 64, (x, y) => (y < 32 ? [0xef, 0x13, 0x0b] : [0x23, 0x1f, 0xd3])),
    SQUARE,
  );
  const ops = instructions(square);
  assert.equal(ops.length, ROWS, 'one run for each row');
  for (const op of ops) {
    assert.deepEqual(readOp(op), op, 'the server would take it as it is');
    assert.equal(op.y, op.y2, 'a run is a horizontal line');
    assert.equal(op.w, BLOCK);
    assert.ok(op.x >= 0 && op.x2 < BOARD.width, 'inside the board');
    assert.ok(op.y >= 0 && op.y < BOARD.height);
  }
  const colours = new Set(ops.map((op) => op.c));
  assert.equal(colours.size, 2, 'the two bands are two colours');
  assert.equal(ops[0].x, ORIGIN.x + Math.floor(BLOCK / 2), 'the first run starts at the left of the picture');
  assert.equal(ops[0].x2, ORIGIN.x + (COLUMNS - 1) * BLOCK + Math.floor(BLOCK / 2), 'and ends at its right');
});

test('white is left undrawn, so a plain picture costs nothing to send', () => {
  const white = squareOf(picture(32, 32, () => [255, 255, 255]), SQUARE);
  assert.deepEqual(instructions(white), []);
});

test('a detailed picture is still only a few thousand instructions', () => {
  const noisy = squareOf(
    picture(SQUARE, SQUARE, (x, y) => [(x * 7 + y * 13) % 256, (x * 29) % 256, (y * 17) % 256]),
    SQUARE,
  );
  const ops = instructions(noisy);
  assert.ok(ops.length > ROWS, 'more than one run a row');
  assert.ok(ops.length <= ROWS * COLUMNS, 'never more than one a block');
  assert.ok(ops.length < 20000, `a drawing must fit on the board (${ops.length} instructions)`);
});

test('the search takes the first picture the results offer, in the order they came, and skips what cannot be drawn', async () => {
  const results = JSON.stringify({
    query: {
      pages: {
        '2': { index: 2, title: 'File:Second.jpg', imageinfo: [{ mime: 'image/jpeg', thumbmime: 'image/jpeg', thumburl: 'https://pictures/second.jpg' }] },
        '1': { index: 1, title: 'File:First.svg', imageinfo: [{ mime: 'image/svg+xml', thumbmime: 'image/svg+xml', thumburl: 'https://pictures/first.svg' }] },
      },
    },
  });
  const url = await searchImage('house', { fetchImpl: fakeFetch([['commons.wikimedia.org', results]]) });
  assert.equal(url, 'https://pictures/second.jpg', 'the drawing it can read, even though it was second');

  const nothing = JSON.stringify({ query: { pages: {} } });
  assert.equal(await searchImage('house', { fetchImpl: fakeFetch([['commons.wikimedia.org', nothing]]) }), null);
  assert.equal(await searchImage('house', { fetchImpl: fakeFetch([['commons.wikimedia.org', null]]) }), null, 'a search that fails is not an error');
});

test('the search asks for the word, as a picture, and says who is asking', async () => {
  let asked = null;
  let headers = null;
  await searchImage('fire engine', {
    fetchImpl: async (url, init) => {
      asked = url;
      headers = init?.headers;
      return { ok: true, status: 200, json: async () => ({ query: { pages: {} } }) };
    },
  });
  assert.ok(asked.includes('gsrsearch=fire+engine'), asked);
  assert.ok(asked.includes('gsrnamespace=6'), 'files only');
  assert.ok(asked.includes('iiurlwidth='), 'a thumbnail, not the original');
  assert.match(headers['user-agent'], /scribblers-bot/);
});

test('a word becomes a picture on the board, from the search to the strokes', async () => {
  const results = JSON.stringify({
    query: { pages: { '1': { index: 1, imageinfo: [{ mime: 'image/png', thumbmime: 'image/png', thumburl: 'https://pictures/house.png' }] } } },
  });
  const file = asPng(picture(32, 32, (x, y) => (y < 16 ? [0, 0, 0] : [255, 255, 255])));
  const { ops, url } = await drawingFor('house', {
    fetchImpl: fakeFetch([
      ['commons.wikimedia.org', results],
      ['pictures/house.png', file],
    ]),
  });
  assert.equal(url, 'https://pictures/house.png');
  assert.ok(ops.length > ROWS * 0.4 && ops.length < ROWS * 0.6, `the black half is drawn and the white half is not (${ops.length} of ${ROWS} rows)`);
  assert.ok(ops.every((op) => op.c === 13), 'in black');
});

test('a word with no picture anywhere leaves the board alone', async () => {
  const nothing = JSON.stringify({ query: { pages: {} } });
  const { ops, url } = await drawingFor('zzzz', { fetchImpl: fakeFetch([['commons.wikimedia.org', nothing]]) });
  assert.deepEqual(ops, []);
  assert.equal(url, null);
});

// ---- guessing ----

/** Hints as the view sends them: a word with some letters shown. */
const hintsFor = (word, shown = []) => [...word].map((ch, at) => ({ ch: shown.includes(at) || [' ', '-'].includes(ch) ? ch : null, fixed: [' ', '-'].includes(ch), shown: shown.includes(at) }));

test('only words of the right shape are guessed', () => {
  const words = ['house', 'horse', 'mouse', 'cat', 'housing', 'hound'];
  assert.deepEqual(wordsThatFit(hintsFor('house'), words).sort(), ['horse', 'hound', 'house', 'mouse']);
  assert.deepEqual(wordsThatFit(hintsFor('house', [0]), words).sort(), ['horse', 'hound', 'house'], 'an h was shown');
  assert.deepEqual(wordsThatFit(hintsFor('house', [0, 4]), words).sort(), ['horse', 'house'], 'and an e at the end');
  assert.deepEqual(wordsThatFit(hintsFor('house', [1, 2]), words).sort(), ['hound', 'house', 'mouse'], '_ou__ keeps three');
  assert.deepEqual(wordsThatFit(hintsFor('house', [0, 2, 3]), words), ['house'], 'h_us_ leaves one');
  assert.deepEqual(wordsThatFit([], words), [], 'no hints, no idea');
});

test('a word with a space or a hyphen in it is matched on those too', () => {
  const words = ['pac-man', 'pacman', 'mad hair', 'bad hair'];
  assert.deepEqual(wordsThatFit(hintsFor('pac-man'), words), ['pac-man']);
  assert.deepEqual(wordsThatFit(hintsFor('mad hair'), words).sort(), ['bad hair', 'mad hair']);
});

test('the bot guesses something that fits, never the same thing twice', () => {
  const words = ['house', 'horse', 'mouse'];
  const tried = new Set();
  const guesses = [];
  for (let n = 0; n < 3; n++) {
    const guess = pickGuess({ hints: hintsFor('house'), words, tried, rng: () => 0.5 });
    assert.ok(words.includes(guess));
    tried.add(guess);
    guesses.push(guess);
  }
  assert.equal(new Set(guesses).size, 3, 'three different guesses');
  assert.equal(pickGuess({ hints: hintsFor('house'), words, tried }), null, 'and then it has nothing left');
});

test('when nothing fits, it still says something', () => {
  const words = ['house', 'cat'];
  assert.equal(pickGuess({ hints: hintsFor('xxxxx'), words, rng: () => 0 }), 'house', 'a word of the right length');
  assert.ok(['house', 'cat'].includes(pickGuess({ hints: hintsFor('xxxxxxxxxxxx'), words, rng: () => 0 })), 'or any word at all');
  assert.equal(pickGuess({ hints: [], words: [], tried: new Set() }), null);
});

test('it guesses from the list the game itself draws from', () => {
  const words = wordList();
  const guess = pickGuess({ hints: hintsFor('house'), words, rng: () => 0.5 });
  assert.ok(words.includes(guess));
  assert.equal([...guess].length, 5);
});
