// Wavelength: a person plays a whole (one turn each) game against two computer players through the UI, on a desktop
// and a phone-sized window.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let host;
before(async () => {
  world = await createWorld({ suite: 'wavelength' });
  host = await world.newUser('host');
  await host.signUp('wave', { displayName: 'Hana' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

/** Clicks the middle of the dial, a little to the side so that it does not sit on the hub. */
async function turnDial(user, fraction) {
  const box = await user.page.$eval('svg.face', (el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  // The dial is the top half circle of the view box (220 x 122, centre at 110, 112, radius 100).
  const angle = Math.PI * (1 - fraction);
  const x = box.left + ((110 + 70 * Math.cos(angle)) * box.width) / 220;
  const y = box.top + ((112 - 70 * Math.sin(angle)) * box.height) / 122;
  await user.page.mouse.click(x, y);
}

test('the host sets up a game with computer players and starts it', { timeout: 60000 }, guarded('lobby', async () => {
  await host.goto('/play/wavelength');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  await host.clickButton('Add a computer player');
  await host.clickButton('Add a computer player');
  await host.waitForText('Players (3 of 8)');
  await host.clickButton('Fewer turns');
  await host.waitForText('1 turn each');
  await host.clickButton('Start the game', { exact: true });
  await host.waitForSelector('.game-frame');
}));

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`at ${viewport.width}x${viewport.height} the page does not scroll and the dial is on screen`, { timeout: 60000 }, guarded(`fit ${viewport.width}`, async () => {
    await host.page.setViewport(viewport);
    await host.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await host.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    const dial = await host.page.$eval('svg.face', (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, vw: innerWidth, vh: innerHeight };
    });
    assert.ok(dial.left >= 0 && dial.right <= dial.vw && dial.top >= 0 && dial.bottom <= dial.vh, `the dial fits: ${JSON.stringify(dial)}`);
  }));
}

test('three turns: clue, guess, reveal and the pop-ups, to a winner', { timeout: 150000 }, guarded('play', async () => {
  await host.page.setViewport({ width: 1280, height: 900 });
  const titles = new Set();
  let clueSeen = false;
  let revealedTarget = false;
  const step = async () => {
    const title = await host.modalTitle();
    if (title) {
      titles.add(title);
      if (/^Scores after Turn 1/.test(title)) revealedTarget = (await host.page.$('.modal svg.face .wedge.w4')) !== null;
      await host.page.keyboard.press('Escape');
      return true;
    }
    if (await host.page.evaluate(() => !!document.querySelector('.clue:not(.hidden)') && document.querySelector('.clue').textContent.length > 4)) clueSeen = true;
    const send = await host.buttonState('Send clue');
    if (send.present) {
      if (send.disabled) return host.fill('form.clue-form input', 'a warm evening').then(() => true);
      return host.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send clue'));
    }
    const lock = await host.buttonState('Lock in guess');
    if (lock.present && lock.disabled) {
      assert.equal(await host.page.$eval('.slider', (el) => el.disabled), false, 'the slider is on for a guesser');
      await turnDial(host, 0.4);
      return true;
    }
    if (lock.present) return host.clickFound(() => [...document.querySelectorAll('button:not([disabled])')].find((b) => b.innerText.trim() === 'Lock in guess'));
    return false;
  };
  await drive({ act: step, finished: async () => titles.has('Final scores'), timeout: 130000, what: 'Wavelength' });
  assert.ok(clueSeen, 'the clue was shown');
  assert.ok(revealedTarget, 'the reveal pop-up shows the target bands');
  assert.ok([...titles].some((t) => /^Scores after Turn 1/.test(t)), `titles: ${[...titles]}`);
  await host.waitForText(/wins? with \d+ points/);
  await host.clickButton('All rounds', { exact: true });
  await host.waitForSelector('.modal');
  const rows = await host.page.$$eval('.modal .score-table tbody th', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(rows.length, 3, `all three turns are in the All rounds table: ${rows}`);
  await host.closeModalWithEsc();
  assert.deepEqual(world.pageErrors, [], 'no page errors');
}));
