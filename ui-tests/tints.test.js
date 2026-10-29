// Tints and Hints: three people in three browsers play a whole (one turn each) game through the UI.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let host;
let second;
let third;
let solo;
let code;
const seen = new Map(); // user -> the pop-up titles that appeared
before(async () => {
  world = await createWorld({ suite: 'tints' });
  host = await world.newUser('host');
  second = await world.newUser('invitee');
  third = await world.newUser('typist');
  await host.signUp('tint', { displayName: 'Hana' });
  await second.signUp('tint', { displayName: 'Ivor' });
  await third.signUp('tint', { displayName: 'Jess' });
  solo = await world.newUser('loner');
  await solo.signUp('tint', { displayName: 'Sol' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

test('the host creates a game; the others join by invite link and by typing the code', { timeout: 60000 }, guarded('lobby', async () => {
  await host.goto('/play/tints-and-hints');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  code = await host.inviteCode();
  await host.waitForCodeInUrl(code);
  assert.equal(await host.copyInvite(), `${world.base}/play/tints-and-hints?${code}`);
  await host.waitForText('Players (1 of 8)');
  await host.waitForText('You need at least 2 players.');
  assert.equal((await host.buttonState('Start the game')).disabled, true);

  // Ivor follows the invite link, which puts him straight into the lobby.
  await second.goto(`/play/tints-and-hints?${code}`);
  await second.waitForText('Waiting for the host to start.');

  // Jess types the code in.
  await third.goto('/play/tints-and-hints');
  await third.fill('input[aria-label="Invite code"]', ` ${code.toUpperCase()} `);
  await third.clickButton('Join', { exact: true });
  await third.waitForText('Waiting for the host to start.');

  await host.waitForText('Players (3 of 8)');
  const names = await host.page.$$eval('.players .name', (els) => els.map((e) => e.textContent.replace(/\(you\)/, '').trim()));
  assert.deepEqual(names, ['Hana', 'Ivor', 'Jess']);

  // Marker colours: Ivor picks another one, which then cannot be taken by Jess.
  const taken = await second.page.$$eval('.swatch-pick', (els) => els.map((e) => ({ disabled: e.disabled, label: e.getAttribute('aria-label') })));
  const free = taken.find((c) => !c.disabled);
  await second.page.click(`button[aria-label="${free.label}"]`);
  await third.page.waitForSelector(`button[aria-label="${free.label}"]:disabled`);

  // One turn each keeps the game short.
  await host.clickButton('Fewer turns');
  await host.waitForText('1 turn each');
  await host.waitForText('3 turns in all');
  assert.equal((await host.buttonState('Start the game')).disabled, false);
}));

test('everyone plays three turns: hints, guesses, the reveal, and the pop-ups', { timeout: 150000 }, guarded('play', async () => {
  const all = [host, second, third];
  for (const u of all) seen.set(u, new Set());
  let hintSeen = false;
  await host.clickButton('Start the game', { exact: true });

  const cellIndex = { [second.label]: 40, [third.label]: 130, [host.label]: 75 };
  const step = async (u) => {
    const title = await u.modalTitle();
    if (title) {
      seen.get(u).add(title);
      await u.page.keyboard.press('Escape');
      return true;
    }
    if (await u.page.evaluate(() => document.body.innerText.includes('a warm evening') && !!document.querySelector('.hint-text'))) hintSeen = true;
    const send = await u.buttonState('Send hint');
    if (send.present) {
      // The first hint is required, so the button stays disabled until something is typed; the next pass then clicks it.
      await u.fill('form.hint input', 'a warm evening');
      return u.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send hint'));
    }
    const lock = await u.buttonState('Lock in guess');
    if (lock.present && lock.disabled) return u.clickFound((n) => document.querySelectorAll('.board button.cell:not([disabled])')[n], cellIndex[u.label]);
    const buttons = ['Lock in guess', 'Continue to the second round', 'Reveal the tint'];
    return u.clickFound((wanted) => [...document.querySelectorAll('button:not([disabled])')].find((b) => wanted.includes(b.innerText.trim())), buttons);
  };
  const finished = async () => all.every((u) => seen.get(u).has('Final scores'));
  await drive({
    act: async () => (await Promise.all(all.map(step))).some(Boolean),
    finished,
    timeout: 130000,
    what: 'Tints and Hints',
  });

  assert.ok(hintSeen, 'a guesser saw the hinter\'s hint');
  for (const u of all) {
    const titles = [...seen.get(u)];
    assert.ok(titles.some((t) => /^Scores after Turn 1/.test(t)), `${u.label} saw the pop-up after turn 1: ${titles}`);
    assert.ok(titles.includes('Final scores'));
  }
  await host.waitForText(/wins? with \d+ points/);
  await host.clickButton('All rounds', { exact: true });
  await host.waitForSelector('.modal');
  const rows = await host.page.$$eval('.modal .score-table tbody th', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(rows.length, 3, `all three turns are in the All rounds table: ${rows}`);
  assert.match(await host.page.$eval('.modal', (e) => e.innerText), /wins!|win\./);
  await host.closeModalWithEsc();
}));

const rect = (user, selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

test('the site header has the title, Rules and Leave game, and the play area has no Leave or Back to the menu button', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await host.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Tints and Hints');
  const names = await host.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  const inPlay = await host.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^(Leave|Back to the menu)/.test(t)));
  assert.deepEqual(inPlay, [], 'no Leave button in the play area');
  assert.ok(await host.page.$('.game-frame'), 'the game is drawn in the standard frame');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window, its rows share the same outer edges and gutters, and the grid cells are square`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await host.page.setViewport(viewport);
    await host.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await host.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    const bar = await rect(host, '.score-bar');
    const arena = await rect(host, '.arena');
    const board = await rect(host, '.board');
    const side = await rect(host, '.side');
    const log = await rect(host, '.box.log');
    const status = await rect(host, '.box.status');
    const bars = await host.page.$$eval('ul[aria-label="Players"] li', (els) => els.map((e) => {
      const b = e.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
    }));
    assert.equal(bars.length, 2, 'a slim bar for each of the other players');
    for (const [name, r] of Object.entries({ arena, board, log, 'first bar': bars[0] })) assert.ok(Math.abs(r.left - bar.left) <= 1, `${name} left edge ${r.left} vs score bar ${bar.left}`);
    for (const [name, r] of Object.entries({ arena, side, status })) assert.ok(Math.abs(r.right - bar.right) <= 1, `${name} right edge ${r.right} vs score bar ${bar.right}`);
    assert.ok(Math.abs(bars[1].left - bars[0].right - 12) <= 1, `the gutter between the bars is the frame's: ${bars[1].left - bars[0].right}`);
    assert.ok(Math.abs(log.right + 12 - status.left) <= 1, 'the bottom boxes have the same gutter');
    assert.ok(board.right <= side.left - 4, 'the grid ends before the controls begin');
    assert.ok(board.bottom <= arena.bottom + 1 && board.top >= arena.top - 1, 'the grid is inside the main area');
    assert.ok(bars[0].top - arena.bottom >= 4 && bars[0].top - arena.bottom <= 12, `the gap between the main area and the bars: ${bars[0].top - arena.bottom}`);
    assert.ok(log.top - bars[0].bottom >= 4 && log.top - bars[0].bottom <= 12, `the gap between the bars and the boxes: ${log.top - bars[0].bottom}`);
    assert.ok(Math.abs(log.bottom - status.bottom) <= 1);
    const cells = await host.page.$$eval('.board button.cell', (els) => els.slice(0, 50).map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }));
    assert.ok(cells.every(([w, h]) => w === h && w >= 14), `square cells, large enough to see: ${cells[0]}`);
  }));
}

test('Leave game in the header leaves the finished game straight away (nothing to confirm)', { timeout: 60000 }, guarded('leave', async () => {
  await host.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await host.waitForText('Start a new game');
}));

test('a host on their own fills the lobby with computer players and plays until a turn result shows', { timeout: 120000 }, guarded('bots', async () => {
  await solo.goto('/play/tints-and-hints');
  await solo.clickButton('Start a new game');
  await solo.waitForText('Waiting for players');
  const seats = () => solo.page.$$eval('.players li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.equal((await solo.buttonState('Start the game')).disabled, true);
  await solo.clickButton('Add a computer player');
  await solo.waitForText('Players (2 of 8)');
  await solo.clickButton('Remove', { scope: '.players li:nth-child(2)' });
  await solo.waitForText('Players (1 of 8)');
  await solo.clickButton('Fill up to 2 players with computer players');
  await solo.waitForText('Players (2 of 8)');
  await solo.clickButton('Add a computer player');
  await solo.waitForText('Players (3 of 8)');
  const rows = await seats();
  assert.match(rows[0], /Sol.*host/);
  assert.match(rows[1], /computer/);
  assert.match(rows[2], /computer/);
  await solo.clickButton('Fewer turns');
  await solo.waitForText('1 turn each');
  await solo.clickButton('Start the game', { exact: true });

  let title = null;
  const step = async () => {
    title = await solo.modalTitle();
    if (title) return false;
    const send = await solo.buttonState('Send hint');
    if (send.present) {
      // The first hint is required, so the button stays disabled until something is typed; the next pass then clicks it.
      await solo.fill('form.hint input', 'a warm evening');
      return solo.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send hint'));
    }
    const lock = await solo.buttonState('Lock in guess');
    if (lock.present && lock.disabled) return solo.clickFound((n) => document.querySelectorAll('.board button.cell:not([disabled])')[n], 77);
    const buttons = ['Lock in guess', 'Continue to the second round', 'Reveal the tint'];
    return solo.clickFound((wanted) => [...document.querySelectorAll('button:not([disabled])')].find((b) => wanted.includes(b.innerText.trim())), buttons);
  };
  await drive({ act: step, finished: async () => /^Scores after Turn/.test(title ?? ''), timeout: 100000, what: 'a turn result with computer players' });
  assert.equal((await solo.page.$$('.score-bar .bot-icon')).length, 2, 'the computers carry the robot icon in the score bar');
  await solo.closeModalWithEsc();
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
