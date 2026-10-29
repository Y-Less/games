// Just One: a person plays a whole (one turn each) game against two computer players through the UI, on a desktop and on a
// phone-sized window.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let host;
before(async () => {
  world = await createWorld({ suite: 'just-one', env: { JUST_ONE_BOT_DELAY: '0-5' } });
  host = await world.newUser('host');
  await host.signUp('jo', { displayName: 'Hana' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

test('the host sets up a game with computer players and starts it', { timeout: 60000 }, guarded('lobby', async () => {
  await host.goto('/play/just-one');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  await host.clickButton('Add a computer player');
  await host.clickButton('Add a computer player');
  await host.waitForText('Players (3 of 7)');
  await host.clickButton('Fewer turns');
  await host.waitForText('1 turn each');
  await host.clickButton('Start the game', { exact: true });
  await host.waitForSelector('.game-frame');
}));

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`at ${viewport.width}x${viewport.height} the page does not scroll and the word and clues are on screen`, { timeout: 60000 }, guarded(`fit ${viewport.width}`, async () => {
    await host.page.setViewport(viewport);
    await host.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await host.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    const box = await host.page.$eval('.word-card', (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, vw: innerWidth, vh: innerHeight };
    });
    assert.ok(box.left >= 0 && box.right <= box.vw && box.top >= 0 && box.bottom <= box.vh, `the word card fits: ${JSON.stringify(box)}`);
  }));
}

test('three turns: clues, the guess, the reveal and the pop-ups, to a winner', { timeout: 150000 }, guarded('play', async () => {
  await host.page.setViewport({ width: 1280, height: 900 });
  const titles = new Set();
  let hiddenFromGuesser = false;
  let writerSawWord = false;
  let popupForGuesser = false;
  const step = async () => {
    const title = await host.modalTitle();
    if (title) {
      titles.add(title);
      await host.page.keyboard.press('Escape');
      return true;
    }
    const word = await host.page.$eval('.word', (el) => ({ text: el.textContent.trim(), hidden: el.classList.contains('hidden') })).catch(() => null);
    if (word?.hidden && word.text === '???') hiddenFromGuesser = true;
    if (word && !word.hidden && word.text.length > 1) writerSawWord = true;
    const send = await host.buttonState('Send clue');
    if (send.present) {
      await host.fill('form.clue-form input', 'zebra');
      return host.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send clue'));
    }
    const guess = await host.buttonState('Guess');
    if (guess.present) {
      if (await host.page.$('.your-turn')) popupForGuesser = true;
      await host.fill('form.guess-form input', 'zzzz');
      return host.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Guess'));
    }
    return false;
  };
  await drive({ act: step, finished: async () => titles.has('Final scores'), timeout: 130000, what: 'Just One' });
  assert.ok(hiddenFromGuesser, 'the guesser did not see the word');
  assert.ok(writerSawWord, 'a writer saw the word');
  assert.ok(popupForGuesser, 'the guesser was told it was their turn');
  assert.ok([...titles].some((t) => /^Scores after Turn 1/.test(t)), `titles: ${[...titles]}`);
  await host.waitForText(/wins? with \d+ points|win with \d+ points/);
  await host.clickButton('All rounds', { exact: true });
  await host.waitForSelector('.modal');
  const rows = await host.page.$$eval('.modal .score-table tbody th', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(rows.length, 3, `all three turns are in the All rounds table: ${rows}`);
  await host.closeModalWithEsc();
  assert.deepEqual(world.pageErrors, [], 'no page errors');
}));
