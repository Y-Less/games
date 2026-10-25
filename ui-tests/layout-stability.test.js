// Layout stability: the areas that hold cards must not grow, shrink or jump while a game is played. Playing a card
// takes it out of your hand, lands it in the trick, changes the status line and so on, and none of that may move the
// rest of the page. For Hearts, Cribbage and Nomination Whist this plays a whole hand (or round) against computer
// players while a recorder inside the page samples the bounding boxes of the main areas every few milliseconds, then
// asserts that each area only ever had one size and one position.
//
// Set LAYOUT_REPORT=1 to print every area's distinct boxes (handy when a change makes one of them move).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
before(async () => {
  world = await createWorld({ suite: 'layout-stability' });
});
after(async () => {
  await world?.close();
});

/** Starts sampling the boxes of `selectors` (document coordinates, so scrolling does not count) inside the page. */
async function startRecording(user, selectors) {
  await user.page.evaluate((list) => {
    const seen = Object.fromEntries(list.map((s) => [s, new Map()]));
    const missing = Object.fromEntries(list.map((s) => [s, 0]));
    const r = (n) => Math.round(n * 2) / 2;
    const sample = () => {
      for (const selector of list) {
        const el = document.querySelector(selector);
        if (!el) {
          missing[selector] += 1;
          continue;
        }
        const b = el.getBoundingClientRect();
        const key = `x${r(b.left + scrollX)} y${r(b.top + scrollY)} ${r(b.width)}x${r(b.height)}`;
        seen[selector].set(key, (seen[selector].get(key) ?? 0) + 1);
      }
    };
    window.__layout = { seen, missing, timer: setInterval(sample, 8) };
  }, selectors);
}

async function stopRecording(user) {
  return user.page.evaluate(() => {
    clearInterval(window.__layout.timer);
    const { seen, missing } = window.__layout;
    return Object.fromEntries(Object.entries(seen).map(([selector, map]) => [selector, { boxes: [...map.entries()], missing: missing[selector] }]));
  });
}

/** Asserts that every area was always present and only ever had one box, unless it is listed in `sizeOnly`. */
function assertStable(game, result, { sizeOnly = [], tolerateMissing = 0 } = {}) {
  const problems = [];
  for (const [selector, { boxes, missing }] of Object.entries(result)) {
    if (process.env.LAYOUT_REPORT) console.log(game, selector, missing ? `(missing ${missing}x)` : '', boxes.map(([k, n]) => `${k} [${n}]`).join(' | '));
    if (missing > tolerateMissing) problems.push(`${selector} was missing from ${missing} samples`);
    if (!boxes.length) problems.push(`${selector} was never seen`);
    const keys = sizeOnly.includes(selector) ? [...new Set(boxes.map(([k]) => k.split(' ')[2]))] : boxes.map(([k]) => k);
    if (keys.length > 1) problems.push(`${selector} changed ${sizeOnly.includes(selector) ? 'size' : 'box'}: ${boxes.map(([k, n]) => `${k} [${n}]`).join(' | ')}`);
  }
  assert.deepEqual(problems, [], `${game}: the layout moved while playing`);
}

async function startGame(user, path, startLabel, { fill = true } = {}) {
  await user.goto(path);
  await user.clickButton(startLabel);
  await user.waitForText('Waiting for players');
  if (fill) {
    // Two or more empty seats offer "Fill the empty seats"; a single empty seat only offers "Add a computer player".
    const bulk = await user.buttonState('Fill the empty seats with computer players');
    await user.clickButton(bulk.present ? 'Fill the empty seats with computer players' : 'Add a computer player');
  }
  await user.waitForNoText('more seat');
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
}

// The score bar sticks under the site header, so its document position follows the scrolling: only its size must hold.
const STICKY = { sizeOnly: ['.score-bar'] };

const finishedModal = (user) => async () => /^Scores after/.test(await user.modalTitle());

test('Hearts: the table, hand and status areas keep one size and position through a whole hand', { timeout: 150000 }, async (t) => {
  const user = await world.newUser('hearts');
  await world.guard('hearts layout', async () => {
    await user.signUp('hlay', { displayName: 'Hearty' });
    await startGame(user, '/play/hearts', 'Start a new game of Hearts');
    await user.waitForText('Hand 1');
    await user.waitForSelector('.hand button.playing-card');
    const areas = ['.score-bar', '.info', '.table', '.table .centre', '.table .centre .slot', '.table .pos1', '.table .pos2', '.table .pos3', '.status', '.mine-area', '.mine-area .hand'];
    await startRecording(user, areas);
    // The hand's cards overlap, so click each wanted card's visible left strip rather than its middle.
    const act = async () => {
      const spot = await user.page.evaluate(() => {
        const centre = (el) => {
          const b = el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        };
        const pass = document.querySelector('.confirm button.primary');
        if (pass && !pass.disabled) return centre(pass);
        const wanted = pass ? '.hand button.playing-card:not(.selected)' : '.hand button.playing-card:not(.dimmed):not([disabled])';
        for (const card of document.querySelectorAll(wanted)) {
          const b = card.getBoundingClientRect();
          const x = b.left + 10;
          const y = b.top + b.height * 0.6;
          if (document.elementFromPoint(x, y)?.closest('button') === card) return { x, y };
        }
        return null;
      });
      if (!spot) return false;
      await user.page.mouse.click(spot.x, spot.y);
      return true;
    };
    await drive({ act, finished: finishedModal(user), what: 'a hand of Hearts', timeout: 120000 });
    assert.deepEqual(world.pageErrors, []);
    assertStable('hearts', await stopRecording(user), STICKY);
  })(t);
});

test('Cribbage: the opponents, crib, play area, hand and log keep one size and position through a whole hand', { timeout: 150000 }, async (t) => {
  const user = await world.newUser('cribbage');
  await world.guard('cribbage layout', async () => {
    await user.signUp('clay', { displayName: 'Cribby' });
    await startGame(user, '/play/cribbage', 'Start a new game');
    await user.waitForText('Send to the crib');
    const areas = ['.score-bar', '.opponents', '.middle', '.zone', '.hand-area', '.log'];
    await startRecording(user, areas);
    const finder = () => {
      const send = document.querySelector('.panel button.primary');
      if (send && /Send to the crib/.test(send.innerText)) return send.disabled ? document.querySelector('.hand button.playing-card:not(.selected):not([disabled])') : send;
      return document.querySelector('.hand button.playing-card:not([disabled])');
    };
    await drive({ act: () => user.clickFound(finder), finished: finishedModal(user), what: 'a hand of Cribbage', timeout: 120000 });
    // At the end of the hand the table gives way to the show, which is a genuine change of screen: allow a few samples of that.
    assertStable('cribbage', await stopRecording(user), { ...STICKY, tolerateMissing: 5 });
  })(t);
});

test('Nomination Whist: the banner, table, status and hand keep one size and position through a whole round', { timeout: 150000 }, async (t) => {
  const user = await world.newUser('whist');
  await world.guard('whist layout', async () => {
    await user.signUp('wlay', { displayName: 'Whisty' });
    await startGame(user, '/play/nomination-whist', 'Start a new game');
    await user.waitForText('Round 1 of 14');
    const areas = ['.score-bar', '.banner', '.table', '.table .ring', '.table .centre', '.table .me', '.status', '.hand-area', '.hand-area .hand'];
    await startRecording(user, areas);
    const finder = () => document.querySelector('.nominate .numbers button.number:not([disabled])') ?? document.querySelector('.hand button.playing-card:not(.dimmed):not([disabled])');
    await drive({ act: () => user.clickFound(finder), finished: finishedModal(user), what: 'a round of Nomination Whist', timeout: 120000 });
    assertStable('nomination-whist', await stopRecording(user), STICKY);
  })(t);
});

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
