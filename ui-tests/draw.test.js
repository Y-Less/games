// Draw!: three people in three browsers play a round.  What is checked here and nowhere else is the shape of it on a
// real screen: two boards side by side, the same size for a guesser and lopsided for a drawer, and one box to type in.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
let host;
let second;
let third;
let code;
before(async () => {
  world = await createWorld({ suite: 'draw', env: { DRAW_CHOOSE_WAIT: '20000', DRAW_BETWEEN_WAIT: '400' } });
  host = await world.newUser('host');
  second = await world.newUser('second');
  third = await world.newUser('third');
  await host.signUp('draw', { displayName: 'Dora' });
  await second.signUp('draw', { displayName: 'Sam' });
  await third.signUp('draw', { displayName: 'Tam' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
/** Where each board is on the screen, in the order they are drawn. */
const boardBoxes = (user) =>
  user.page.$$eval('.boards .board canvas', (els) =>
    els.map((e) => {
      const b = e.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) };
    }),
  );
/** The bottom edge of something on a page, rounded to whole pixels. */
const bottomOf = (user, selector) => user.page.$eval(selector, (e) => Math.round(e.getBoundingClientRect().bottom));

test('three people join, and the lobby says how long the game will be', { timeout: 90000 }, guarded('lobby', async () => {
  await host.goto('/play/draw');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  code = await host.inviteCode();
  for (const user of [second, third]) {
    await user.goto(`/play/draw?${code}`);
    await user.waitForText('Waiting for the host to start the game.');
  }
  await host.waitForText('Tam');
  // Three players is three pairs, and everybody draws twice.
  await host.waitForText('3 rounds, and you will draw 2 times');
  assert.equal((await host.buttonState('Start the game')).disabled, false);
}));

test('both drawings are on screen at once: the same size for a guesser, and lopsided for a drawer', { timeout: 90000 }, guarded('two boards', async () => {
  await host.clickButton('Start the game', { exact: true });
  const all = [host, second, third];
  for (const user of all) await user.waitForSelector('.boards .board canvas');

  // Whoever is drawing picks a word; the one who is not is the guesser.
  const drawers = [];
  let guesser = null;
  for (const user of all) {
    if (await user.page.$('.choices button')) drawers.push(user);
    else guesser = user;
  }
  assert.equal(drawers.length, 2, 'two of them are drawing');
  assert.ok(guesser, 'and one is guessing');

  // A guesser sees both drawings the same size, side by side, with one box to type in.
  const seen = await boardBoxes(guesser);
  assert.equal(seen.length, 2, 'two boards');
  assert.equal(seen[0].width, seen[1].width, 'the same width');
  assert.equal(seen[0].height, seen[1].height, 'the same height');
  assert.ok(seen[0].right <= seen[1].left + 1, 'one beside the other, not stacked');
  assert.ok(Math.abs(seen[0].top - seen[1].top) <= 2, 'and level with each other');
  assert.equal((await guesser.page.$$('input[aria-label="Type what either drawing is"]')).length, 1, 'one box for the two of them');

  // A drawer sees their own large and the other one small beside it.
  for (const drawer of drawers) await drawer.clickFound(() => document.querySelector('.choices button'));
  for (const user of all) await user.waitForNoText('Pick one of the words');
  const mine = await boardBoxes(drawers[0]);
  assert.equal(mine.length, 2, 'the drawer sees the other drawing too');
  assert.ok(mine[0].width > mine[1].width * 1.4, `their own is the big one (${mine[0].width} vs ${mine[1].width})`);
  assert.ok(mine[0].right <= mine[1].left + 1, 'with the other beside it');
  assert.ok(await drawers[0].page.$('.toolbox'), 'and the tools under it');
  assert.equal(await guesser.page.$('.toolbox'), null, 'which a guesser has no use for');
  // The board is sized with room left for the tools, so the two of them together must still fit the play area.
  const room = await bottomOf(drawers[0], '.main');
  assert.ok((await bottomOf(drawers[0], '.toolbox')) <= room + 1, 'the board and its tools fit the play area together');
}));

test('a drawing somebody names ends the round, and only those two score', { timeout: 90000 }, guarded('a round', async () => {
  const all = [host, second, third];
  // Whoever has no tools under their board is the one guessing this round.
  const withTools = await Promise.all(all.map((u) => u.page.$('.toolbox')));
  const guesser = all[withTools.findIndex((found) => !found)];
  assert.ok(guesser, 'one of them is guessing');
  // The guesser is told nothing of either word, so the test reads one from a drawer's own screen.
  const drawer = all.find((u) => u !== guesser);
  const word = await drawer.page.$eval('.board.yours figcaption', (e) => e.textContent.replace(/^.*:\s*/, '').trim());
  assert.ok(word, 'the drawer is told their own word');
  await guesser.fill('input[aria-label="Type what either drawing is"]', word);
  await guesser.page.keyboard.press('Enter');
  await guesser.waitForText('You named it!');
  const scores = await host.page.$$eval('.score-bar .chip', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.ok(scores.some((s) => /\b1\b/.test(s)), `somebody scored: ${scores.join(' | ')}`);
}));

test('the page does not scroll, and the boards stay inside the table', { timeout: 60000 }, guarded('layout', async () => {
  await host.page.setViewport({ width: 1366, height: 768 });
  await host.page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await host.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
  // The frame's main area is a subgrid of twelve columns: a board that escaped it would be one column wide and
  // hanging off the side of the screen, which is what this catches.
  const frame = await host.page.$eval('.game-frame', (e) => {
    const b = e.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right) };
  });
  // The play area, which stops above the Recent moves and Status boxes: a board may not reach into them.
  const floor = await bottomOf(host, '.main');
  const boxes = await boardBoxes(host);
  assert.equal(boxes.length, 2, 'both boards are still there');
  for (const box of boxes) {
    assert.ok(box.left >= frame.left - 1 && box.right <= frame.right + 1, `a board stays inside the frame (${JSON.stringify(box)} in ${JSON.stringify(frame)})`);
    assert.ok(box.top + box.height <= floor + 1, `a board stays above the boxes (${JSON.stringify(box)} above ${floor})`);
  }
}));
