// Layout stability: the areas that hold cards must not grow, shrink or jump while a game is played. Playing a card
// takes it out of your hand, lands it in the trick, changes the status line and so on, and none of that may move the
// rest of the page. For Hearts, Cribbage and Nomination Whist this plays a whole hand (or round) against computer
// players while a recorder inside the page samples the bounding boxes of the main areas every few milliseconds, then
// asserts that each area only ever had one size and one position.
//
// Gaudi, Splendour, Azulejo and Rummikub are played the same way (their recent-actions lists, tables and racks must not grow), and
// Dixnt (against computer players) and Tints and Hints (two people) are checked for the areas that stay on screen.
//
// Set LAYOUT_REPORT=1 to print every area's distinct boxes (handy when a change makes one of them move).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive, sleep } from './helpers.js';

let world;
before(async () => {
  world = await createWorld({ suite: 'layout-stability' });
});
after(async () => {
  await world?.close();
});

/** Starts sampling the boxes of `selectors` (document coordinates, so scrolling does not count) inside the page. */
async function startRecording(user, selectors, { stopWhen = null } = {}) {
  await user.page.evaluate((list, stop) => {
    const seen = Object.fromEntries(list.map((s) => [s, new Map()]));
    const missing = Object.fromEntries(list.map((s) => [s, 0]));
    const r = (n) => Math.round(n * 2) / 2;
    let overflow = -Infinity;
    const sample = () => {
      if (stop && document.querySelector(stop)) return; // the game is over: its result screen is allowed to look different
      overflow = Math.max(overflow, document.documentElement.scrollHeight - window.innerHeight);
      window.__layout.overflow = overflow;
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
  }, selectors, stopWhen);
}

async function stopRecording(user) {
  return user.page.evaluate(() => {
    clearInterval(window.__layout.timer);
    const { seen, missing } = window.__layout;
    const result = Object.fromEntries(Object.entries(seen).map(([selector, map]) => [selector, { boxes: [...map.entries()], missing: missing[selector] }]));
    result.overflow = window.__layout.overflow;
    return result;
  });
}

/** Asserts that every area was always present and only ever had one box, unless it is listed in `sizeOnly`. */
function assertStable(game, result, { sizeOnly = [], tolerateMissing = 0, allowOverflow = false } = {}) {
  const problems = [];
  const { overflow, ...areas } = result;
  // The page itself must not need to scroll while playing: everything fits the window.
  if (overflow > 0 && !allowOverflow) problems.push(`the page was ${overflow}px taller than the window`);
  for (const [selector, { boxes, missing }] of Object.entries(areas)) {
    if (process.env.LAYOUT_REPORT) console.log(game, selector, missing ? `(missing ${missing}x)` : '', boxes.map(([k, n]) => `${k} [${n}]`).join(' | '));
    if (missing > tolerateMissing) problems.push(`${selector} was missing from ${missing} samples`);
    if (!boxes.length) problems.push(`${selector} was never seen`);
    const keys = sizeOnly.includes(selector) ? [...new Set(boxes.map(([k]) => k.split(' ')[2]))] : boxes.map(([k]) => k);
    if (keys.length > 1) problems.push(`${selector} changed ${sizeOnly.includes(selector) ? 'size' : 'box'}: ${boxes.map(([k, n]) => `${k} [${n}]`).join(' | ')}`);
  }
  assert.deepEqual(problems, [], `${game}: the layout moved while playing`);
}

async function startGame(user, path, startLabel, { fill = true, lobby = null } = {}) {
  await user.goto(path);
  await user.clickButton(startLabel);
  await user.waitForText('Waiting for players');
  if (lobby) await lobby(user); // a game that wants its own lobby settings (fewer seats, a lower target)
  else if (fill) {
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

// Two common desktop window sizes: every game must fit both without scrolling the page.
const VIEWPORTS = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];

for (const viewport of VIEWPORTS) {
const at = `${viewport.width}x${viewport.height}`;

test(`Hearts at ${at}: the table, hand, bottom boxes and every piece keep one size and position through a whole hand, line up on the grid, and the page does not scroll`, { timeout: 150000 }, async (t) => {
  const user = await world.newUser('hearts');
  await user.page.setViewport(viewport);
  await world.guard('hearts layout', async () => {
    await user.signUp('hlay', { displayName: 'Hearty' });
    await startGame(user, '/play/hearts', 'Start a new game of Hearts');
    await user.waitForText('Hand 1');
    await user.waitForSelector('.hand button.playing-card');
    await sleep(300);
    // Exact boxes (the score bar no longer sticks, so it is held to a position too), and no scrolling at all.
    const areas = ['.game-frame', '.score-bar', '.felt', '.felt .trick', '.felt .opp.left', '.felt .opp.top', '.felt .opp.right', '.felt .my-fan', '.felt .confirm', '.box.log', '.box.status', '.box.log .game-log'];
    await startRecording(user, areas);
    // The hand is a fan of overlapping, turned cards, so click a point of each wanted card that is really its own.
    let clicks = 0;
    const act = async () => {
      const spot = await user.page.evaluate(() => {
        const centre = (el) => {
          const b = el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        };
        const pass = document.querySelector('.confirm:not(.hidden) button.primary');
        if (pass && !pass.disabled) {
          pass.scrollIntoView({ block: 'nearest' });
          return centre(pass);
        }
        const wanted = pass ? '.hand button.playing-card:not(.selected)' : '.hand button.playing-card:not(.dimmed):not([disabled])';
        for (const card of document.querySelectorAll(wanted)) {
          card.scrollIntoView({ block: 'nearest' });
          const b = card.getBoundingClientRect();
          for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.15, 0.5], [0.85, 0.5], [0.5, 0.1]]) {
            const x = b.left + b.width * fx;
            const y = b.top + b.height * fy;
            if (document.elementFromPoint(x, y)?.closest('button') === card) return { x, y };
          }
        }
        return null;
      });
      if (!spot) return false;
      await user.page.mouse.click(spot.x, spot.y);
      clicks += 1;
      if (process.env.LAYOUT_SHOTS && clicks === 8) {
        await sleep(300);
        await user.page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/hearts.png` });
      }
      return true;
    };
    await drive({ act, finished: finishedModal(user), what: 'a hand of Hearts', timeout: 120000 });
    assert.deepEqual(world.pageErrors, []);
    assertStable('hearts', await stopRecording(user), {});
    assert.equal(await user.page.evaluate(() => document.querySelector('.box.log .game-log').scrollTop), 0, 'the newest move is in view');
    await assertGridEdges(user, 'hearts', viewport, { left: ['.felt'], right: ['.felt'] });
  })(t);
});

test(`Cribbage at ${at}: the board, piles, play area, hand and bottom boxes keep one size and position through a whole hand, line up on the grid, and the page does not scroll`, { timeout: 150000 }, async (t) => {
  const user = await world.newUser('cribbage');
  await user.page.setViewport(viewport);
  await world.guard('cribbage layout', async () => {
    await user.signUp('clay', { displayName: 'Cribby' });
    await startGame(user, '/play/cribbage', 'Start a new game');
    await user.waitForText('Send to the crib');
    await sleep(300);
    // Exact boxes (the score bar no longer sticks, so it is held to a position too), and no scrolling at all.
    const areas = ['.game-frame', '.score-bar', '.arena', '.mine-col', '.right-col', '.zone', '.hand-area', '.board-box', '.board-box svg.board', '.piles', '.box.log', '.box.status', '.box.log .game-log'];
    await startRecording(user, areas);
    const finder = () => {
      const send = document.querySelector('.zone button.primary');
      if (send && /Send to the crib/.test(send.innerText)) return send.disabled ? document.querySelector('.hand button.playing-card:not(.selected):not([disabled])') : send;
      return document.querySelector('.hand button.playing-card:not([disabled])');
    };
    await drive({ act: () => user.clickFound(finder), finished: finishedModal(user), what: 'a hand of Cribbage', timeout: 120000 });
    // The same areas are drawn in every phase (discarding, pegging, the show), so none may ever be missing or move.
    assertStable('cribbage', await stopRecording(user), {});
    assert.equal(await user.page.evaluate(() => document.querySelector('.box.log .game-log').scrollTop), 0, 'the newest scoring line is in view');
    await assertGridEdges(user, 'cribbage', viewport, {
      left: ['.mine-col'],
      right: ['.right-col'],
      gutters: [['.mine-col', '.right-col']],
    });
  })(t);
});

/**
 * Edge and gutter alignment of a frame-based game: every listed row must start and end on the score bar's outer edges,
 * the bottom boxes must be one gutter apart and end on one line, and the frame must end inside the window.
 * `left` and `right` list the selectors whose left (right) edges are the score bar's; `gutters` lists [leftSelector,
 * rightSelector] pairs that must be one gutter apart (the gutter being the gap between the two bottom boxes).
 */
async function assertGridEdges(user, game, viewport, { left = [], right = [], gutters = [] }) {
  const problems = await user.page.evaluate((spec, height) => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const out = [];
    const bar = box('.score-bar');
    const log = box('.box.log');
    const status = box('.box.status');
    const frame = box('.game-frame');
    const near = (a, b, what) => Math.abs(a - b) > 1 && out.push(`${what}: ${a} vs ${b}`);
    if (frame.bottom > height) out.push(`the frame ends at ${frame.bottom}, below the window (${height})`);
    if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
    const gutter = status.left - log.right;
    if (gutter < 10 || gutter > 14) out.push(`the gutter between the bottom boxes is ${gutter}`);
    near(log.bottom, status.bottom, 'the bottom boxes end on one line');
    near(log.left, bar.left, 'Recent moves left edge');
    near(status.right, bar.right, 'Status right edge');
    for (const sel of spec.left) {
      const b = box(sel);
      b ? near(b.left, bar.left, `${sel} left edge`) : out.push(`${sel} is missing`);
    }
    for (const sel of spec.right) {
      const b = box(sel);
      b ? near(b.right, bar.right, `${sel} right edge`) : out.push(`${sel} is missing`);
    }
    for (const [l, r] of spec.gutters) {
      const x = box(l);
      const y = box(r);
      x && y ? near(y.left - x.right, gutter, `the gutter between ${l} and ${r}`) : out.push(`${l} or ${r} is missing`);
    }
    return out;
  }, { left, right, gutters }, viewport.height);
  assert.deepEqual(problems, [], `${game}: edges and gutters do not line up at ${viewport.width}x${viewport.height}`);
}

/** Clicking a player's chip in the score bar opens their popup, clicking it again closes it, and neither moves `areas`. */
async function assertChipPopupMovesNothing(user, game, areas) {
  const boxes = () => user.page.evaluate((list) => list.map((sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? [b.left, b.top, b.width, b.height].map(Math.round).join(',') : null; }), areas);
  const was = await boxes();
  await user.page.click('.score-bar button.chip-button');
  await user.waitForSelector('.main .player-popup');
  assert.deepEqual(await boxes(), was, `${game}: opening a player's popup moved something`);
  await user.page.click('.score-bar button.chip-button');
  await user.waitForSelector('.main .player-popup', { hidden: true });
  assert.deepEqual(await boxes(), was, `${game}: closing a player's popup moved something`);
}

test(`Nomination Whist at ${at}: the trick, nomination zone, hand and both bottom boxes keep one size and position through a whole round, line up on the grid, and the page does not scroll`, { timeout: 150000 }, async (t) => {
  const user = await world.newUser('whist');
  await user.page.setViewport(viewport);
  await world.guard('whist layout', async () => {
    await user.signUp('wlay', { displayName: 'Whisty' });
    await startGame(user, '/play/nomination-whist', 'Start a new game');
    await user.waitForText('Round 1 of 14');
    await user.waitForSelector('.game-frame .hand .playing-card');
    await sleep(300);
    // Exact boxes (the score bar no longer sticks, so it is held to a position too), and no scrolling at all.
    const areas = ['.game-frame', '.scorebar', '.score-bar', '.game-frame .main', '.centre', '.centre .trick-circle', '.nominate', '.nominate .numbers', '.mine', '.hand', '.box.log', '.box.status', '.box.log .game-log'];
    await startRecording(user, areas);
    const finder = () => document.querySelector('.nominate .numbers button.number:not([disabled])') ?? document.querySelector('.hand button.playing-card:not(.dimmed):not([disabled])');
    let clicks = 0;
    const act = async () => {
      const done = await user.clickFound(finder);
      clicks += done ? 1 : 0;
      if (process.env.LAYOUT_SHOTS && clicks === 5 && done) {
        await sleep(300);
        await user.page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/whist-${at}.png` });
      }
      return done;
    };
    await drive({ act, finished: finishedModal(user), what: 'a round of Nomination Whist', timeout: 120000 });
    assertStable('nomination-whist', await stopRecording(user), {});
    await assertGridEdges(user, 'nomination-whist', viewport, {
      left: ['.mine', '.centre'],
      right: ['.nominate', '.mine'],
      gutters: [],
    });
    await user.closeModalWithEsc(); // the round's scores pop-up covers the chips
    await sleep(300);
    await assertChipPopupMovesNothing(user, 'nomination-whist', ['.score-bar', '.centre', '.nominate', '.mine', '.hand', '.box.log', '.box.status']);
  })(t);
});

// Gaudi and Azulejo: the "recent actions" list used to grow line by line as the game went on. It must now be a box of
// one size, whatever has happened so far, and the newest entry must stay in view inside it.
const gaudiFinder = () => {
  const confirm = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Choose this window');
  if (confirm) return confirm.disabled ? document.querySelector('.option:not(.locked)') : confirm;
  if (!document.querySelector('.game-status .headline.mine')) return null;
  const mem = (window.__gaudi ??= { key: '', tried: [] });
  const key = `${document.querySelector('.game-status .headline').innerText}|${document.querySelectorAll('.mine .space.filled').length}|${document.querySelectorAll('.pool-die').length}`;
  if (mem.key !== key) Object.assign(mem, { key, tried: [] });
  const endTurn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'End turn' && !b.disabled);
  if (!document.querySelector('.game-status .headline').innerText.includes('place a die;')) return endTurn;
  const chosen = document.querySelector('.pool-die.chosen');
  if (chosen) {
    const legal = document.querySelector('.mine .space.legal');
    if (legal) return legal;
    mem.tried.push(chosen.getAttribute('aria-label'));
  }
  const next = [...document.querySelectorAll('.pool-die')].find((d) => !mem.tried.includes(d.getAttribute('aria-label')) && !d.classList.contains('chosen'));
  return next ?? endTurn;
};
const splendourFinder = () => {
  const actions = document.querySelector('.mine-board .actions');
  if (!actions || !document.querySelector('.game-status .headline.mine')) return null;
  const byText = (re) => [...actions.querySelectorAll('button')].find((b) => re.test(b.innerText.trim()) && !b.disabled);
  // Over ten tokens: your own tokens are the selector, then confirm in the bottom row of your board.
  const tokens = [...document.querySelectorAll('.mine-board .token-btn:not(:disabled)')];
  if (tokens.length) return byText(/^Return [0-9]+ of/) ?? tokens.find((t) => !t.classList.contains('picked')) ?? tokens[0];
  // Several nobles: the eligible ones in the market glow; pick one.
  const noble = document.querySelector('.nobles button.noble');
  if (noble) return noble;
  // A card is selected: buy it if we can, otherwise let it go.
  const buy = [...actions.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Buy this card');
  if (buy) return buy.disabled ? byText(/^Cancel$/) : buy;
  const take = byText(/^Take [0-9]/);
  if (take) return take;
  const pass = byText(/^Pass/);
  if (pass) return pass;
  const card = document.querySelector('.market button.dev-card.affordable');
  if (card && !document.querySelector('.supply .stack-btn.picked')) return card;
  return [...document.querySelectorAll('.supply button.stack-btn')].find((b) => b.getAttribute('aria-pressed') === 'false' && !/: 0 left/.test(b.getAttribute('aria-label')));
};
const azulejoFinder = () => {
  if (!document.querySelector('.game-status .headline.mine')) return null;
  const column = document.querySelector('.spot.choice');
  if (column) return column;
  if (document.querySelector('.workshop button.pick[aria-pressed="true"]')) return document.querySelector('.mine .line.ok') ?? document.querySelector('.mine .floor.open');
  return document.querySelector('.workshop button.pick:not(:disabled)');
};

const rummikubFinder = () => [...document.querySelectorAll('.actions button')].find((b) => /^(Draw a tile|Pass)$/.test(b.innerText.trim()) && !b.disabled);

/**
 * Plays a whole game as a human who only ever clicks what `finder` returns (closing every pop-up on the way) while the
 * boxes of `areas` are sampled. `ready` is a regular expression for the text that shows the game proper has begun, and
 * `finished(user)` says when it is over. The result screen is not sampled (`stopWhen`): it is allowed to differ.
 */
function wholeGameLayout({ name, path, finder, ready, finished, areas, stopWhen, newest, allowOverflow = false, timeout = 280000, lobby = null }) {
  test(`${name} at ${at}: ${areas.length} areas keep one size and position through a whole game${allowOverflow ? '' : ', and the page does not scroll'}`, { timeout }, async (t) => {
    const user = await world.newUser(name.toLowerCase());
    await user.page.setViewport(viewport);
    await world.guard(`${name} layout`, async () => {
      await user.signUp(`${name.slice(0, 3).toLowerCase()}lay`, { displayName: `${name}r` });
      await startGame(user, path, 'Start a new game', { lobby });
      let acts = 0;
      const act = async () => {
        const title = await user.modalTitle();
        if (title) {
          if (title === 'Final scores') return false;
          await user.page.keyboard.press('Escape');
          return true;
        }
        const done = await user.clickFound(finder);
        acts += done ? 1 : 0;
        if (process.env.LAYOUT_SHOTS && done && acts % 12 === 0 && acts <= 36) {
          await sleep(300);
          await user.page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/${name.toLowerCase()}-${at}-${acts}.png` });
        }
        return done;
      };
      await drive({ act, finished: () => user.text().then((text) => ready.test(text)), what: `the start of a game of ${name}`, timeout: 60000 });
      await startRecording(user, [...areas, ...(process.env.LAYOUT_EXTRA ? process.env.LAYOUT_EXTRA.split(',') : [])], { stopWhen });
      await drive({ act, finished: () => finished(user), what: `a game of ${name}`, timeout: timeout - 80000 });
      assertStable(name.toLowerCase(), await stopRecording(user), { ...STICKY, tolerateMissing: 200, allowOverflow });
      for (const [selector, expected] of Object.entries(newest ?? {})) {
        assert.equal(await user.page.evaluate((sel) => document.querySelector(sel)?.scrollTop ?? null, selector), expected, `${selector}: the newest entry is in view`);
      }
    })(t);
  });
}

// The "recent actions" lists of Gaudi and Azulejo used to grow line by line as the game went on. Each is now a box of
// one size whatever has happened so far, with the newest entry (the first) in view. Gaudi is a tall page that cannot be
// scaled to fit the window, so for it only stability is checked, not that the page does not scroll.
const finalShown = (user) => user.page.$('section.final').then(Boolean);
wholeGameLayout({
  name: 'Gaudi',
  path: '/play/gaudi',
  finder: gaudiFinder,
  ready: /Round 1 of 10/,
  finished: finalShown,
  areas: ['.score-bar', '.game-frame', '.arena', '.mine-col', '.mine', '.mine .pool-col', '.mine .pool', '.mine .actions', '.mine .actions button:nth-child(1)', '.mine .actions button:nth-child(2)', '.mine .track', '.right-col', '.box.log', '.box.status', '.box.log .game-log'],
  stopWhen: 'section.final',
  newest: { '.box.log .game-log': 0 },
});
wholeGameLayout({
  name: 'Splendour',
  path: '/play/splendour',
  finder: splendourFinder,
  ready: /Round 1/,
  finished: (user) => user.page.$('.box.status .standings').then(Boolean),
  areas: ['.score-bar', '.game-frame', '.arena', '.market', '.mine-col', '.mine-board', '.mine-board .actions', '.supply', '.box.log', '.box.status', '.box.log .game-log'],
  stopWhen: '.box.status .standings',
  newest: { '.box.log .game-log': 0 },
  lobby: async (user) => {
    await user.clickButton('2 players', { exact: true });
    await user.clickButton('Add a computer player');
    await user.clickButton('10', { exact: true });
  },
});
wholeGameLayout({
  name: 'Azulejo',
  path: '/play/azulejo',
  finder: azulejoFinder,
  ready: /Round 1/,
  finished: finalShown,
  areas: ['.score-bar', '.game-frame', '.arena', '.mine-col', '.right-col', '.workshop-panel', '.box.log', '.box.status', '.box.log .game-log'],
  stopWhen: 'section.final',
  newest: { '.box.log .game-log': 0 },
});
// Rummikub: a human who only draws a tile each turn (so the rack grows) while the computer players lay sets on the table.
wholeGameLayout({
  name: 'Rummikub',
  path: '/play/rummikub',
  finder: rummikubFinder,
  ready: /Round 1/,
  finished: (user) => user.text().then((text) => /wins the game|share the win/.test(text)),
  areas: ['.game-frame', '.scorebar', '.game-frame .main', '.felt', '.rack-panel', '.rack', '.actions', '.actions .set.new', '.actions .buttons', '.box.log', '.box.status', '.box.log .game-log'],
  newest: { '.box.log .game-log': 0 },
});
test(`Rummikub at ${at}: the table, rack, buttons and both bottom boxes line up on the grid, the chip popups move nothing and the page does not scroll`, { timeout: 90000 }, async (t) => {
  const user = await world.newUser('rummikub-grid');
  await user.page.setViewport(viewport);
  await world.guard('rummikub grid', async () => {
    await user.signUp('rgrid', { displayName: 'Rummer' });
    await startGame(user, '/play/rummikub', 'Start a new game');
    await user.waitForSelector('[data-rack] .tile');
    await sleep(300);
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    await assertGridEdges(user, 'rummikub', viewport, {
      left: ['.felt', '.rack-panel'],
      right: ['.felt', '.actions'],
      gutters: [['.rack-panel', '.actions']],
    });
    await assertChipPopupMovesNothing(user, 'rummikub', ['.score-bar', '.felt', '.rack-panel', '.actions', '.box.log', '.box.status']);
  })(t);
});


// Dixnt: every round has its own screens (choose a word, play a card, vote, results), so the page as a whole is
// allowed to change between them, but the player bar and the hand must never change size within a game, and the
// "waiting for" line must keep one size, whoever is still to play or vote.
test(`Dixnt at ${at}: the table, controls and hand zones keep one size and position through a game against computer players, and the page does not scroll`, { timeout: 200000 }, async (t) => {
  const user = await world.newUser('dixnt');
  await user.page.setViewport(viewport);
  await world.guard('dixnt layout', async () => {
    await user.signUp('dixlay', { displayName: 'Dixie' });
    await user.goto('/play/dixnt');
    await user.clickButton('Start a new game');
    await user.waitForText('Waiting for players');
    await user.clickButton('Fill up to 3 players with computer players');
    await user.clickButton('Add a computer player');
    await user.clickButton('Start the game', { exact: true });
    await user.waitForText('Round 1 of');
    await startRecording(user, ['.score-bar', '.game-frame', '.arena', '.table-zone', '.controls', '.hand-zone', '.hand .cards', '.box.log', '.box.status', '.box.log .game-log'], { stopWhen: '.standings' });
    const act = async () => {
      const title = await user.modalTitle();
      if (title) {
        if (title === 'Final scores') return false;
        await user.page.keyboard.press('Escape');
        return true;
      }
      if (await user.page.$('.viewer')) {
        const played = await user.clickFound(() => [...document.querySelectorAll('.viewer .actions button')].find((b) => /^Play this/.test(b.innerText.trim())));
        if (!played) await user.page.keyboard.press('Escape');
        return true;
      }
      if (await user.page.$('input[aria-label="Your word or phrase"]')) {
        await user.fill('input[aria-label="Your word or phrase"]', 'Dragon');
        return user.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Lock it in' && !b.disabled));
      }
      const text = await user.text();
      if (/play the card that fits|you did not see the word/i.test(text) && !(await user.page.$('.hand .slot.played'))) return user.clickFound(() => document.querySelector('.hand .slot'));
      {
        const voted = await user.clickFound(() => [...document.querySelectorAll('.table figcaption button')].find((b) => /^(Vote|Pick this one)$/.test(b.innerText.trim())));
        if (voted) return true;
      }
      return user.clickFound(() => [...document.querySelectorAll('button.primary')].find((b) => /^(Next round|That was the last round)/.test(b.innerText.trim())));
    };
    await drive({ act, finished: () => user.page.$('.standings').then(Boolean), what: 'a game of Dixnt', timeout: 150000 });
    // Every zone keeps its size AND its position through word, picking, voting and results, and the page never scrolls.
    // (The word pop-up floats over the play area and takes no room; the table itself may be replaced by the ideas.)
    assertStable('dixnt', await stopRecording(user), { tolerateMissing: 100000 });
    const edges = await user.page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const bar = r('.score-bar');
      return { left: ['.arena', '.box.log'].map((s) => r(s).left - bar.left), right: ['.arena', '.box.status'].map((s) => r(s).right - bar.right) };
    }).catch(() => null);
    if (edges) assert.ok([...edges.left, ...edges.right].every((d) => Math.abs(d) <= 1), `outer edges line up: ${JSON.stringify(edges)}`);
  })(t);
});


// Tints and Hints has no computer players, so two people play a two-turn game; the first person's page is sampled. The
// turn panel differs by role and phase, but the board under it and the score bar must keep one size, and the hint line
// is always there (empty until the hint arrives), so the hint appearing does not push the board down.
test(`Tints and Hints at ${at}: every zone keeps one size and position through a two-player game, and the page does not scroll`, { timeout: 150000 }, async (t) => {
  const host = await world.newUser('tint-host');
  const second = await world.newUser('tint-second');
  await host.page.setViewport(viewport);
  await second.page.setViewport(viewport);
  await world.guard('tints layout', async () => {
    await host.signUp('tinlay', { displayName: 'Hana' });
    await second.signUp('tinlay', { displayName: 'Ivor' });
    await host.goto('/play/tints-and-hints');
    await host.clickButton('Start a new game');
    await host.waitForText('Waiting for players');
    const code = await host.inviteCode();
    await second.goto(`/play/tints-and-hints?${code}`);
    await second.waitForText('Waiting for the host to start.');
    await host.waitForText('Players (2 of 8)');
    await host.clickButton('Fewer turns');
    await host.waitForText('1 turn each');
    await host.clickButton('Start the game', { exact: true });
    await host.waitForText('Turn 1 of');
    await startRecording(host, ['.score-bar', '.game-frame', '.arena', '.board', '.side', '.side .block', '.bars', '.box.log', '.box.status', '.box.log .game-log', ...(process.env.LAYOUT_EXTRA ? process.env.LAYOUT_EXTRA.split(',') : [])]);
    const all = [host, second];
    const seen = new Set();
    const step = async (u) => {
      const title = await u.modalTitle();
      if (title) {
        if (u === host) seen.add(title);
        await u.page.keyboard.press('Escape');
        return true;
      }
      const send = await u.buttonState('Send hint');
      if (send.present && !send.disabled) {
        await u.fill('form.hint input', 'a warm evening');
        return u.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send hint'));
      }
      const lock = await u.buttonState('Lock in guess');
      if (lock.present && lock.disabled) return u.clickFound(() => document.querySelectorAll('.board button.cell:not([disabled])')[40]);
      const buttons = ['Lock in guess', 'Continue to the second round', 'Reveal the tint', 'Next turn', 'Finish the game'];
      return u.clickFound((wanted) => [...document.querySelectorAll('button:not([disabled])')].find((b) => wanted.includes(b.innerText.trim())), buttons);
    };
    await drive({ act: async () => (await Promise.all(all.map(step))).some(Boolean), finished: async () => seen.has('Final scores'), timeout: 120000, what: 'Tints and Hints' });
    // Every zone keeps its size and its position through hints, guesses and the reveal, and the page never scrolls.
    assertStable('tints-and-hints', await stopRecording(host), { tolerateMissing: 100000 });
  })(t);
});

}

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
