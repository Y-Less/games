// Trivium: a person plays a whole quiz against two computer players through the UI - the wheel turning, a question
// answered by pressing a button, the markers travelling to where everybody pressed, the right answer lighting up, and
// the final scores - on a desktop and a phone-sized window.  The questions are the made-up ones (see FAST_ENV in
// helpers.js), so this never asks the web for anything.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, sleep } from './helpers.js';

let world;
let host;
before(async () => {
  world = await createWorld({ suite: 'trivium' });
  host = await world.newUser('host');
  await host.signUp('triv', { displayName: 'Tess' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

/** The answer buttons as they are on the page: where they are, and what they are showing. */
const buttons = () =>
  host.page.$$eval('button.answer', (list) =>
    list.map((el) => {
      const box = el.getBoundingClientRect();
      return { text: el.textContent.trim(), left: box.left, top: box.top, width: box.width, height: box.height, right: el.classList.contains('right'), chosen: el.classList.contains('chosen') };
    }),
  );

/** Every marker on the board, by where its middle is. */
const markers = () =>
  host.page.$$eval('.marker', (list) =>
    list.map((el) => {
      const box = el.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, waiting: el.classList.contains('waiting') };
    }),
  );

test('the host sets up a short quiz with computer players and starts it', { timeout: 60000 }, guarded('lobby', async () => {
  await host.goto('/play/trivium');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  await host.clickButton('Add a computer player');
  await host.clickButton('Add a computer player');
  await host.waitForText('Players (3 of 8)');
  await host.clickButton('Fewer rounds');
  await host.clickButton('Fewer rounds');
  await host.waitForText('1 round');
  for (let n = 0; n < 3; n++) await host.clickButton('Fewer questions a round');
  await host.waitForText('2 questions a round');
  await host.waitForText('2 questions in all');
  await host.clickButton('Start the game', { exact: true });
  await host.waitForSelector('.game-frame');
}));

test('the wheel turns, and stops on a category the table then says it is asking about', { timeout: 60000 }, guarded('wheel', async () => {
  await host.waitForSelector('.wheel');
  await host.waitForText('Spinning for a category');
  const turned = await host.page.$eval('.wheel .turn', (el) => getComputedStyle(el).transform);
  assert.notEqual(turned, 'none', 'the wheel is turned to where it stops');
  await host.waitForSelector('button.answer');
  const text = await host.text();
  assert.match(text, /Category: \w/, `the table names the category it landed on: ${text.slice(0, 200)}`);
}));

test('pressing an answer records it, and the markers then travel to where everybody pressed', { timeout: 60000 }, guarded('answer', async () => {
  const before = await buttons();
  assert.equal(before.length >= 2, true, 'the question has answers to press');
  assert.ok(
    (await markers()).every((marker) => marker.waiting),
    'every marker is on its name while the question is open',
  );
  const home = await markers();

  // Press one of them well off its middle, so that the marker's landing spot is somewhere particular.
  const target = before[before.length - 1];
  await host.page.mouse.click(target.left + target.width * 0.25, target.top + target.height * 0.75);
  await host.waitForText('Your answer is in.');
  assert.ok((await buttons()).some((b) => b.chosen), 'the button shows which one was pressed');

  await host.waitForSelector('button.answer.right');
  await host.waitForText('The answer was');
  const landed = await markers();
  assert.equal(landed.length, home.length, 'every player still has a marker');
  assert.ok(
    landed.some((marker, index) => Math.abs(marker.x - home[index].x) > 1 || Math.abs(marker.y - home[index].y) > 1),
    'at least one marker left its name',
  );
  const mine = landed.find((marker) => !marker.waiting);
  assert.ok(mine, 'and one of them has landed');
}));

test('the quiz runs itself to the end and shows the final scores', { timeout: 90000 }, guarded('finish', async () => {
  // The second question comes by itself; answer it if it is still up, then let the quiz finish on its own.
  await host.waitForSelector('button.answer:not(.right):not(.wrong)', { timeout: 30000 }).catch(() => {});
  const open = await buttons();
  if (open.length && !open.some((b) => b.right)) {
    await host.page.mouse.click(open[0].left + open[0].width / 2, open[0].top + open[0].height / 2).catch(() => {});
  }
  await host.waitForText('That is the quiz.', { timeout: 60000 });
  await host.waitForText('Tess');
  assert.match(await host.text(), /Round 1 of 1/);
}));

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`at ${viewport.width}x${viewport.height} the page does not scroll and the board is on screen`, { timeout: 60000 }, guarded(`fit ${viewport.width}`, async () => {
    await host.page.setViewport(viewport);
    await host.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await sleep(400);
    const fit = await host.page.evaluate(() => {
      const board = document.querySelector('.board');
      const box = board?.getBoundingClientRect();
      return { overflow: document.documentElement.scrollHeight - window.innerHeight, board: box ? { left: box.left, right: box.right, bottom: box.bottom } : null, width: window.innerWidth, height: window.innerHeight };
    });
    assert.ok(fit.overflow <= 2, `the page does not scroll (overflowed by ${fit.overflow})`);
    assert.ok(fit.board, 'the board is drawn');
    assert.ok(fit.board.left >= -1 && fit.board.right <= fit.width + 1, `the board is within the window (${fit.board.left} to ${fit.board.right} of ${fit.width})`);
    assert.ok(fit.board.bottom <= fit.height + 1, `and its name row is on screen (${fit.board.bottom} of ${fit.height})`);
  }));
}

test('nothing in the page went wrong along the way', () => {
  assert.deepEqual(world.pageErrors, []);
});
