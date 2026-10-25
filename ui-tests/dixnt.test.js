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
let code;
let bot = null;
let botName;
before(async () => {
  world = await createWorld({ suite: 'dixnt' });
  host = await world.newUser('host');
  second = await world.newUser('invitee');
  third = await world.newUser('typist');
  await host.signUp('dix', { displayName: 'Dora' });
  await second.signUp('dix', { displayName: 'Dan' });
  await third.signUp('dix', { displayName: 'Dee' });
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
    if ((text.includes('Play the card that fits') || text.includes('get to see the word')) && !(await u.page.$('.hand .slot.played'))) return u.clickFound(() => document.querySelector('.hand .slot'));
    if (!text.includes('Your pick') && /Who was in the dark\?/.test(text)) return u.clickFound(() => [...document.querySelectorAll('.table figcaption button')].find((b) => b.innerText.trim() === 'Vote'));
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

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
