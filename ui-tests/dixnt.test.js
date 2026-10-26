// Dixnt: three people in three browsers, plus a bot process, play a round through the UI.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createWorld, drive, root } from './helpers.js';

let world;
let host;
let second;
let third;
let solo;
let code;
let bot = null;
let botName;
before(async () => {
  world = await createWorld({ suite: 'dixnt' });
  host = await world.newUser('host');
  second = await world.newUser('invitee');
  third = await world.newUser('typist');
  solo = await world.newUser('loner');
  await host.signUp('dix', { displayName: 'Dora' });
  await second.signUp('dix', { displayName: 'Dan' });
  await third.signUp('dix', { displayName: 'Dee' });
  await solo.signUp('dix', { displayName: 'Sol' });
});
after(async () => {
  if (bot && bot.exitCode === null) bot.kill();
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

test('the host creates a game; two people join (by invite link and by typing the code) and a bot process joins', { timeout: 90000 }, guarded('lobby', async () => {
  await host.goto('/play/dixnt');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  code = await host.inviteCode();
  assert.ok((await host.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()))).includes('Leave game'), 'the header offers Leave game in the lobby too');
  assert.deepEqual(await host.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((s) => /^Leave/.test(s))), [], 'no Leave button in the lobby');
  await host.waitForCodeInUrl(code);
  assert.equal(await host.copyInvite(), `${world.base}/play/dixnt?${code}`);
  assert.equal((await host.buttonState('Need 2 more players')).disabled, true, 'cannot start alone');

  // Dan follows the invite link: the code is filled in and he presses Join.
  await second.goto(`/play/dixnt?${code}`);
  await second.waitForSelector('input[aria-label="Invite code"]');
  assert.equal(await second.page.$eval('input[aria-label="Invite code"]', (e) => e.value), code);
  await second.clickButton('Join', { exact: true });
  await second.waitForText('Waiting for the host to start the game.');

  // Dee types the code.
  await third.goto('/play/dixnt');
  await third.fill('input[aria-label="Invite code"]', code);
  await third.clickButton('Join', { exact: true });
  await third.waitForText('Waiting for the host to start the game.');
  await host.waitForText('Dan');
  await host.waitForText('Dee');

  // A bot supplies a fourth player (it uses only the public API, like a browser would).
  botName = world.uniqueName('bot');
  bot = spawn(process.execPath, [path.join(root, 'modules/dixnt/bots/bot.js'), '--join', code, '--name', botName, '--url', world.base, '--delay', '0-30', '--token-file', path.join(world.dataDir, 'bot-tokens.json')], { stdio: 'ignore' });
  await host.waitForText(botName);

  // One turn at choosing the word each: a four-round game, of which we play the first round.
  await host.fill('label.row:nth-of-type(2) input.num', '1');
  await host.page.keyboard.press('Tab');
  await host.waitForText('4 rounds with 4 players');
  assert.equal((await host.buttonState('Start the game')).disabled, false);
}));

test('a round: the chooser types a word, everyone plays a card and votes, and the scores pop-up shows Round 1', { timeout: 150000 }, guarded('round', async () => {
  const all = [host, second, third];
  const popups = new Map(all.map((u) => [u, null]));
  await host.clickButton('Start the game', { exact: true });
  await host.waitForText('Round 1 of 4');

  const step = async (u) => {
    const title = await u.modalTitle();
    if (title) {
      if (/^Scores after/.test(title)) popups.set(u, { title, text: await u.page.$eval('.modal', (e) => e.innerText) });
      await u.page.keyboard.press('Escape');
      return true;
    }
    if (await u.page.$('.viewer')) {
      const played = await u.clickFound(() => [...document.querySelectorAll('.viewer .actions button')].find((b) => /^Play this/.test(b.innerText.trim())));
      if (!played) await u.page.keyboard.press('Escape');
      return true;
    }
    if (await u.page.$('input[aria-label="Your word or phrase"]')) {
      await u.fill('input[aria-label="Your word or phrase"]', 'Dragon');
      return u.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Lock it in' && !b.disabled));
    }
    const text = await u.text();
    if (/play the card that fits|you did not see the word/i.test(text) && !(await u.page.$('.hand .slot.played'))) return u.clickFound(() => document.querySelector('.hand .slot'));
    if (!text.includes('Your pick')) return u.clickFound(() => [...document.querySelectorAll('.table figcaption button')].find((b) => b.innerText.trim() === 'Vote'));
    return false;
  };
  await drive({
    act: async () => (await Promise.all(all.map(step))).some(Boolean),
    finished: async () => all.every((u) => popups.get(u)),
    timeout: 90000,
    what: 'a round of Dixnt',
  });

  for (const u of all) {
    const popup = popups.get(u);
    assert.equal(popup.title, 'Scores after Round 1');
    assert.match(popup.text, /Round 1/);
    assert.match(popup.text, /was the imposter/);
    assert.match(popup.text, /Total/);
  }
  // The word the chooser typed was shown to everyone, and the results page is up.
  await host.waitForText('Dragon');
  await host.waitForText(/Next round: .* chooses the word/);
  await host.clickButton('All rounds', { exact: true });
  await host.waitForSelector('.modal');
  assert.equal(await host.modalTitle(), 'Scores so far');
  assert.deepEqual(await host.page.$$eval('.modal .score-table tbody th', (els) => els.map((e) => e.textContent.trim())), ['Round 1']);
  await host.closeModalWithEsc();
}));

test('a reload mid-game puts you back in the same game', { timeout: 60000 }, guarded('reload', async () => {
  await second.page.reload({ waitUntil: 'domcontentloaded' });
  await second.waitForText('Round 1 of 4');
  await second.waitForCodeInUrl(code);
  await second.waitForSelector('.score-bar');
}));

test('the host removes a person from the game through their popup: Remove player, with an inline confirmation', { timeout: 60000 }, guarded('remove person', async () => {
  const chips = () => host.page.$$eval('.score-bar button.chip-button', (els) => els.map((e) => e.innerText.replace(/s+/g, ' ').trim()));
  await host.waitForSelector('.word-popup', { hidden: true }).catch(() => {});
  assert.equal((await chips()).length, 3, 'a chip for every other player');
  // A guest has the popup (the facts), but no Remove button.
  await second.waitForSelector('.score-bar button.chip-button');
  await second.page.click('.score-bar button.chip-button');
  await second.waitForSelector('.main .player-popup');
  assert.doesNotMatch(await second.page.$eval('.player-popup', (e) => e.innerText), /Remove/);
  await second.page.keyboard.press('Escape');
  await second.waitForSelector('.player-popup', { hidden: true });
  // The host picks the bot process's account (a person, as far as the game is concerned).
  const at = (await chips()).findIndex((c) => c.includes(botName));
  assert.ok(at >= 0, `${botName} is in the score bar`);
  await host.page.click(`.score-bar li:nth-child(${at + 2}) button.chip-button`);
  await host.waitForSelector('.main .player-popup');
  assert.match(await host.page.$eval('.player-popup', (e) => e.innerText), new RegExp(botName));
  await host.clickButton('Remove player', { scope: '.player-popup' });
  await host.clickButton('Yes, remove', { scope: '.player-popup' });
  await host.waitForSelector('.player-popup', { hidden: true });
  // Mid-game a computer player takes over the removed person's seat, so the table stays the same size.
  const started = Date.now();
  while ((await chips()).some((c) => c.includes(botName)) && Date.now() - started < 15000) await new Promise((r) => setTimeout(r, 100));
  assert.ok(!(await chips()).some((c) => c.includes(botName)), 'they are gone from the score bar');
  assert.equal((await chips()).length, 3);
  assert.equal((await host.page.$$('.score-bar .bot')).length, 1, 'a computer player took their seat');
}));

test('a host on their own fills the table with built-in computer players, starts, and the bots play their cards', { timeout: 90000 }, guarded('bots', async () => {
  await solo.goto('/play/dixnt');
  await solo.clickButton('Start a new game');
  await solo.waitForText('Waiting for players');
  const seats = () => solo.page.$$eval('ul.seats .seat', (els) => els.map((e) => ({ bot: e.classList.contains('bot'), text: e.innerText.replace(/\s+/g, ' ').trim() })));
  assert.equal((await solo.buttonState('Need 2 more players')).disabled, true);

  await solo.clickButton('Add a computer player');
  await solo.waitForText('Need 1 more player');
  assert.equal((await seats()).filter((s) => s.bot).length, 1);
  await solo.clickButton('Remove', { scope: '.seat.bot' });
  await solo.waitForText('Need 2 more players');
  await solo.clickButton('Fill up to 3 players with computer players');
  await solo.waitForText('Start the game');
  const rows = await seats();
  assert.deepEqual(rows.map((s) => s.bot), [false, true, true]);
  assert.match(rows[0].text, /Sol.*you.*host/i);
  assert.match(rows[1].text, /computer/i);
  assert.equal((await solo.buttonState('Start the game')).disabled, false);
  await solo.clickButton('Add a computer player'); // a third computer player, so that one can be removed mid-game later
  await solo.waitForNoText('Need');

  // The host is the first chooser.
  await solo.clickButton('Start the game', { exact: true });
  await solo.waitForSelector('input[aria-label="Your word or phrase"]');
}));

const rect = (user, selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

test('the site header has the title, Rules and Leave game, and neither the lobby nor the play area has a Leave button', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await solo.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Dixnt');
  const names = await solo.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  const inPlay = await solo.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
  assert.deepEqual(inPlay, [], 'no Leave button in the play area');
  assert.ok(await solo.page.$('.game-frame'), 'the game is drawn in the standard frame');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window, and its rows share the same outer edges and gutters`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await solo.page.setViewport(viewport);
    await solo.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await solo.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    const bar = await rect(solo, '.score-bar');
    const arena = await rect(solo, '.arena');
    const log = await rect(solo, '.box.log');
    const status = await rect(solo, '.box.status');
    const hand = await rect(solo, '.hand-zone');
    const controls = await rect(solo, '.controls');
    assert.equal(await solo.page.$('ul[aria-label="Players"]'), null, 'no duplicate player bars: the score bar is the one list');
    for (const [name, r] of Object.entries({ arena, log })) assert.ok(Math.abs(r.left - bar.left) <= 1, `${name} left edge ${r.left} vs score bar ${bar.left}`);
    for (const [name, r] of Object.entries({ arena, status })) assert.ok(Math.abs(r.right - bar.right) <= 1, `${name} right edge ${r.right} vs score bar ${bar.right}`);
    assert.ok(Math.abs(log.right + 12 - status.left) <= 1, 'the bottom boxes have the same gutter');
    assert.ok(log.top - arena.bottom >= 4 && log.top - arena.bottom <= 12, `the gap between the main area and the boxes: ${log.top - arena.bottom}`);
    assert.ok(Math.abs(log.bottom - status.bottom) <= 1);
    assert.ok(Math.abs(hand.bottom - arena.bottom) <= 1, 'the hand ends the main area');
    assert.ok(controls.bottom <= hand.top && controls.top >= arena.top, 'the controls zone sits between the table and the hand');
  }));
}

test('the chooser types the word, and the three computer players play a card by themselves', { timeout: 90000 }, guarded('bots play', async () => {
  await solo.page.setViewport({ width: 1280, height: 900 });
  await solo.fill('input[aria-label="Your word or phrase"]', 'Dragon');
  await solo.clickFound(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Lock it in' && !b.disabled));
  await solo.waitForSelector('.table figcaption button.vote');
  assert.equal((await solo.page.$$('.score-bar .bot')).length, 3, 'the bots are marked as computers in the score bar');
  assert.equal(await solo.page.$$eval('.table figure', (els) => els.length), 3, 'a card from each of the three computer players is on the table (the chooser plays none)');
}));

test('the host always has Remove in a player popup: a computer player is removed mid-game, end to end', { timeout: 60000 }, guarded('remove computer', async () => {
  const chips = () => solo.page.$$eval('.score-bar button.chip-button', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  await solo.waitForSelector('.word-popup', { hidden: true }); // the chosen word is shown large for a few seconds first
  assert.equal((await chips()).length, 3, 'a chip for every other player');
  assert.equal(await solo.page.$eval('.score-bar button.chip-button', (e) => e.title), 'Show details');
  await solo.page.click('.score-bar button.chip-button');
  await solo.waitForSelector('.main .player-popup');
  assert.match(await solo.page.$eval('.player-popup', (e) => e.innerText), /computer[\s\S]*Score[\s\S]*Remove computer player/i);
  const popup = await rect(solo, '.player-popup');
  const main = await rect(solo, '.main');
  assert.ok(popup.top >= main.top - 1 && popup.bottom <= main.bottom + 1 && popup.left >= main.left && popup.right <= main.right, 'the popup sits inside the main area');
  assert.ok(Math.abs((popup.left + popup.right) / 2 - (main.left + main.right) / 2) <= 2, 'and is centred at the top of it');
  await solo.clickButton('Remove computer player', { scope: '.player-popup' });
  await solo.waitForText('from the game?'); // the confirmation is inline, in the popup
  assert.equal(await solo.page.evaluate(() => Boolean(document.querySelector('.modal-backdrop'))), false, 'not a window.confirm or modal');
  await solo.clickButton('Cancel', { scope: '.player-popup' });
  await solo.waitForNoText('from the game?');
  await solo.clickButton('Remove computer player', { scope: '.player-popup' });
  await solo.clickButton('Yes, remove', { scope: '.player-popup' });
  await solo.waitForSelector('.player-popup', { hidden: true });
  const started = Date.now();
  while ((await chips()).length !== 2 && Date.now() - started < 15000) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await chips()).length, 2, 'one computer player fewer in the score bar');
  assert.equal((await solo.page.$$('.score-bar .bot')).length, 2);
}));

test('Leave game in the header asks first, then leaves the game', { timeout: 60000 }, guarded('leave', async () => {
  await solo.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await solo.waitForText('Your score will be lost.');
  await solo.clickButton('Stay', { exact: true });
  await solo.waitForNoText('Your score will be lost.');
  await solo.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await solo.clickButton('Yes, leave', { exact: true });
  await solo.waitForText('Start a new game');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
