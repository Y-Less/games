// Tints and Hints: three people in three browsers play a whole (one turn each) game through the UI.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let host;
let second;
let third;
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
    if (send.present && !send.disabled) {
      await u.fill('form.hint input', 'a warm evening');
      return u.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send hint'));
    }
    const lock = await u.buttonState('Lock in guess');
    if (lock.present && lock.disabled) return u.clickFound((n) => document.querySelectorAll('.board button.cell:not([disabled])')[n], cellIndex[u.label]);
    const buttons = ['Lock in guess', 'Continue to the second round', 'Reveal the tint', ...(u === host ? ['Next turn', 'Finish the game'] : [])];
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
  await host.waitForText(/We have a winner|It is a tie/);
  await host.clickButton('All rounds', { exact: true });
  await host.waitForSelector('.modal');
  const rows = await host.page.$$eval('.modal .score-table tbody th', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(rows.length, 3, `all three turns are in the All rounds table: ${rows}`);
  assert.match(await host.page.$eval('.modal', (e) => e.innerText), /wins!|win\./);
  await host.closeModalWithEsc();
  await host.clickButton('Back to the menu', { exact: true });
  await host.waitForText('Start a new game');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
