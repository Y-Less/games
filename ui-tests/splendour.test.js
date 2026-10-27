// Splendour: the shared seat lobby, a reload mid-game, then a whole game against a computer player played by clicking
// gems and cards: no score pop-up between rounds, a stable layout that fits the window, and the final result.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'splendour' });
  user = await world.newUser('human');
  await user.signUp('splendid', { displayName: 'Splendid' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const seatKinds = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c))));

test('the seat lobby: seat count, play-to target and computer players; Start needs every seat filled', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/splendour');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
  await user.waitForCodeInUrl(code);
  assert.equal(await user.copyInvite(), `${world.base}/play/splendour?${code}`);

  assert.deepEqual(await seatKinds(), ['human', 'empty', 'empty', 'empty']);
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot', 'bot', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);

  // Two bots go again, then two seats and a low target keep the game short (one bot is left to fill the second seat).
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('1 more seat to fill.');
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('2 more seats to fill.');
  await user.clickButton('2 players', { exact: true });
  await user.waitForNoText('more seat');
  await user.clickButton('10', { exact: true });
  await user.page.waitForFunction(() => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.innerText.trim() === '10'));
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);
}));

test('starting deals the table, and a reload resumes the same room', { timeout: 60000 }, guarded('start and reload', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  await user.waitForText('First to 10 prestige');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$$eval('.level-row button.dev-card:not(.pile-button)', (c) => c.length), 12, 'twelve cards on the table');
  assert.equal(await user.page.$$eval('.noble-row > *', (c) => c.length), 3, 'three nobles for two players');

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('.score-bar');
  await user.waitForText('First to 10 prestige');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$('.entry'), null, 'not back at the start screen');
}));

test('playing a whole game by clicking gems and cards: no pop-up between rounds, a layout that never moves, then the final result', { timeout: 240000 }, guarded('play a game', async () => {
  const titles = new Set();
  const finder = () => {
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
  // The boxes of the main areas, the page's overflow and the shell's scale, sampled all game long: each must only ever
  // have one value (the recent-moves box in particular must not grow as moves are made).
  const seen = {};
  const probe = () =>
    user.page.evaluate(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return 'missing';
        const b = el.getBoundingClientRect();
        return Math.round(b.left + scrollX) + ',' + Math.round(b.top + scrollY) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height);
      };
      const frame = document.querySelector('.field-frame');
      return {
        table: box('.table-view'),
        market: box('.market'),
        mine: box('.mine-col'),
        board: box('.mine-board'),
        actions: box('.mine-board .actions'),
        status: box('.box.status'),
        supply: box('.supply'),
        log: box('.box.log'),
        logList: box('.box.log .game-log'),
        status: box('.box.status'),
        scale: (Number.parseFloat(frame?.style.zoom) || 1) + ' ' + getComputedStyle(document.querySelector('.arena')).fontSize,
        overflow: String(Math.max(0, document.documentElement.scrollHeight - innerHeight)),
      };
    });
  const act = async () => {
    const title = await user.modalTitle();
    if (title) {
      titles.add(title);
      if (title === 'Final scores') return false; // the game is over: leave this pop-up for the checks below
      await user.page.keyboard.press('Escape');
      return true;
    }
    for (const [key, value] of Object.entries(await probe())) (seen[key] ??= new Set()).add(value);
    return user.clickFound(finder);
  };
  const done = () => user.page.$('.box.status .standings').then(Boolean);
  await drive({ act, finished: done, what: 'a game of Splendour', timeout: 220000 });

  assert.deepEqual([...titles].filter((t) => t !== 'Final scores'), [], 'no pop-up between rounds');
  for (const [key, values] of Object.entries(seen)) {
    const live = [...values];
    assert.equal(live.length, 1, key + ' kept one box all game: ' + live.join(' | '));
  }
  assert.equal([...seen.overflow][0], '0', 'the page never needed to scroll');
  assert.match([...seen.scale][0], /^1 /, 'the shell did not scale the game down');
  assert.match(await user.page.$eval('.box.status .headline', (el) => el.innerText), /wins with|shared win/);
  assert.ok((await user.page.$$eval('.box.status .standings li', (els) => els.length)) === 2);
  // The final pop-up arrives by itself, with every round in its table.
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Final scores');
  const rounds = await user.page.$$eval('.modal .score-table tbody th', (els) => els.length);
  assert.ok(rounds >= 3, `the All rounds table has the rounds played (${rounds})`);
  assert.match(await user.page.$eval('.modal', (e) => e.innerText), /wins!/);
  await user.closeModalWithEsc();
}));

test('after the game ends, a reload still shows the result and Play again starts a new lobby', { timeout: 60000 }, guarded('again', async () => {
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('.box.status .standings');
  await user.waitForCodeInUrl(code);
  await user.clickButton('Play again', { exact: true });
  await user.waitForText('Waiting for players');
  assert.deepEqual((await seatKinds()).sort(), ['bot', 'human'], 'the same two players are back in the lobby (the seating may be shuffled)');
  await user.clickButton('Start the game', { exact: true });
  await user.waitForText('Round 1');
  await user.waitForSelector('.market');
  await user.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await user.clickButton('Yes, leave', { exact: true });
  await user.waitForText('Start a new game');
  assert.equal(await user.page.$('.table-view'), null);
}));

test('the site header shows the title, Rules and Leave game, and the play area has none of them', { timeout: 60000 }, guarded('header', async () => {
  await user.goto('/play/splendour');
  await user.clickButton('Start a new game');
  await user.clickButton('2 players', { exact: true });
  await user.clickButton('Add a computer player');
  await user.waitForNoText('more seat');
  const lobbyInPlay = await user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
  assert.deepEqual(lobbyInPlay, [], 'no Leave button in the lobby: the header has it');
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Splendour');
  assert.equal(await user.page.$('.play h1'), null);
  const names = await user.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  const inPlay = await user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
  assert.deepEqual(inPlay, [], 'no Leave button in the play area');
}));

test('the table fits the window at common desktop sizes, without the page scrolling or being scaled', { timeout: 90000 }, guarded('fits the window', async () => {
  const rect = (selector) =>
    user.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
    }, selector);
  for (const [width, height] of [[1366, 768], [1600, 900], [1920, 1080]]) {
    await user.page.setViewport({ width, height });
    await new Promise((r) => setTimeout(r, 500)); // the frame re-measures after the window changes
    await user.page.waitForFunction(() => document.documentElement.scrollHeight <= innerHeight, { timeout: 5000 });
    const result = await user.page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const frame = document.querySelector('.field-frame');
      return {
        overflow: document.documentElement.scrollHeight - innerHeight,
        scale: Number.parseFloat(frame.style.zoom) || 1,
        bar: rect('.score-bar').top - rect('header.bar').bottom,
        bottoms: ['.market', '.mine-col', '.table-view'].map((s) => rect(s).bottom),
        viewport: innerHeight,
        clipped: ['.market', '.mine-col'].map((s) => { const e = document.querySelector(s); return [s, e.scrollHeight - e.clientHeight, e.scrollWidth - e.clientWidth]; }).filter(([, h, w]) => h > 1 || w > 1),
      };
    });
    const label = width + 'x' + height + ' ' + JSON.stringify(result);
    assert.ok(result.overflow <= 0, 'the page does not scroll at ' + label);
    assert.equal(result.scale, 1, 'the shell does not scale the game at ' + label);
    assert.ok(result.bar >= -2 && result.bar < 80, 'the score bar sits under the header at ' + label);
    assert.ok(result.bottoms.every((bottom) => bottom <= result.viewport), 'everything is inside the window at ' + label);
    assert.deepEqual(result.clipped, [], 'nothing in the main area is cut off at ' + label);

    // The rows share the outer edges and the gutters of the frame's grid.
    const bar = await rect('.score-bar');
    const market = await rect('.market');
    const mine = await rect('.mine-col');
    const nobles = await rect('.nobles');
    const levels = await rect('.levels');
    const log = await rect('.box.log');
    const status = await rect('.box.status');
    for (const [name, r] of Object.entries({ market, log })) assert.ok(Math.abs(r.left - bar.left) <= 1, `${name} left edge ${r.left} vs score bar ${bar.left} at ${label}`);
    for (const [name, r] of Object.entries({ mine, status })) assert.ok(Math.abs(r.right - bar.right) <= 1, `${name} right edge ${r.right} vs score bar ${bar.right} at ${label}`);
    assert.ok(levels.left - nobles.right === 12 && mine.left - levels.right === 12, `the gutters between the columns are 12px at ${label}: ${levels.left - nobles.right}, ${mine.left - levels.right}`);
    // The nobles only take their narrow column; the cards and your play area share the rest (about 50% and 33%).
    const whole = bar.right - bar.left;
    for (const [name, r, share] of [['nobles', nobles, 0.167], ['cards', levels, 0.5], ['mine', mine, 0.333]]) assert.ok(Math.abs((r.right - r.left) / whole - share) < 0.03, `${name} take about ${share} of the width at ${label}: ${(r.right - r.left) / whole}`);
    assert.equal(await user.page.$('.others'), null, 'no row of duplicate player bars');
    assert.ok(log.top - market.bottom >= 4 && log.top - market.bottom <= 12, `the gap between the main row and the boxes at ${label}: ${log.top - market.bottom}`);
    assert.ok(Math.abs(mine.bottom - market.bottom) <= 1, 'the columns end on the same line at ' + label);
    assert.ok(Math.abs(log.bottom - status.bottom) <= 1);

    // Toggling another player's board from the score bar moves nothing else.
    const areas = ['.score-bar', '.market', '.mine-col', '.mine-board', '.supply', '.box.log', '.box.status'];
    const before = await Promise.all(areas.map(rect));
    await user.page.click('.score-bar .chip:not(.me) button.chip-button');
    await user.waitForSelector('.arena .popup section.board');
    assert.deepEqual(await Promise.all(areas.map(rect)), before, 'opening a board moved something at ' + label);
    assert.equal((await user.page.$$('.arena .popup')).length, 1);
    assert.equal(await user.page.$eval('.score-bar .chip:not(.me) button.chip-button', (e) => e.getAttribute('aria-pressed')), 'true');
    const popup = await rect('.arena .popup');
    const arena = await rect('.arena');
    assert.ok(popup.top >= arena.top - 1 && popup.bottom <= arena.bottom + 1 && popup.left >= arena.left && popup.right <= arena.right, 'the pop-up sits inside the main area at ' + label);
    await user.page.keyboard.press('Escape');
    await user.waitForSelector('.arena .popup', { hidden: true });
    assert.deepEqual(await Promise.all(areas.map(rect)), before, 'closing a board moved something at ' + label);
  }
}));

test('with four players the five nobles sit in two columns inside the market and overlap nothing', { timeout: 90000 }, guarded('nobles', async () => {
  await user.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await user.clickButton('Yes, leave', { exact: true });
  await user.waitForText('Start a new game');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await user.page.setViewport({ width, height });
    await new Promise((r) => setTimeout(r, 500)); // the frame re-measures after the window changes
    const found = await user.page.evaluate(() => {
      const box = (el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      };
      const nobles = [...document.querySelectorAll('.nobles .noble')].map(box);
      const others = Object.fromEntries(['.market', '.mine-col', '.box.log', '.box.status', '.score-bar', '.levels'].map((s) => [s, document.querySelector(s) ? box(document.querySelector(s)) : null]));
      const width = (selector) => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
      return { nobles, others, nobleWidth: width('.nobles .noble'), cardWidth: width('.levels .dev-card:not(.back)') };
    });
    const label = width + 'x' + height + ' ' + JSON.stringify(found);
    const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    assert.equal(found.nobles.length, 5, 'five nobles for four players at ' + label);
    assert.ok(found.nobleWidth > 0 && found.nobleWidth <= found.cardWidth + 1, 'a noble is no wider than a card at ' + label + ': ' + found.nobleWidth + ' vs ' + found.cardWidth);
    assert.equal(new Set(found.nobles.map((n) => Math.round(n.left))).size, 2, 'the nobles are in two columns at ' + label);
    assert.equal(new Set(found.nobles.map((n) => Math.round(n.top))).size, 3, 'in three rows at ' + label);
    const { market } = { market: found.others['.market'] };
    for (const [i, n] of found.nobles.entries()) {
      assert.ok(n.left >= market.left - 1 && n.right <= market.right + 1 && n.top >= market.top - 1 && n.bottom <= market.bottom + 1, 'noble ' + i + ' is inside the market at ' + label);
      for (const [name, other] of Object.entries(found.others)) {
        if (!other || name === '.market') continue;
        assert.ok(!overlap(n, other), 'noble ' + i + ' overlaps ' + name + ' at ' + label);
      }
      for (const [j, m] of found.nobles.entries()) if (j > i) assert.ok(!overlap(n, m), 'nobles ' + i + ' and ' + j + ' overlap at ' + label);
    }
    await user.page.screenshot({ path: process.env.NOBLE_SHOTS ? process.env.NOBLE_SHOTS + '/nobles-' + width + 'x' + height + '.png' : undefined });
  }
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
