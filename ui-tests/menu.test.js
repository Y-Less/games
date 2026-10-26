// The game menu, the game page shell and the Rules dialog.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWorld, root } from './helpers.js';

const GAMES = [
  { id: 'cribbage', name: 'Cribbage', players: '1–4 players', category: 'Card games' },
  { id: 'dixnt', name: 'Dixnt', players: '3–12 players', category: 'Party games' },
  { id: 'hearts', name: 'Hearts', players: '1–4 players', category: 'Card games' },
  { id: 'nomination-whist', name: 'Nomination Whist', players: '1–7 players', category: 'Card games' },
  { id: 'tints-and-hints', name: 'Tints and Hints', players: '2–8 players', category: 'Party games' },
];

let world;
let user;
before(async () => {
  world = await createWorld({ suite: 'menu' });
  user = await world.newUser('player');
  await user.signUp('menu', { displayName: 'Menu Tester' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

test('the menu lists the five original games (and any newer ones) with their player counts and categories', { timeout: 60000 }, guarded('menu', async () => {
  await user.waitForText('Welcome, Menu Tester');
  const shown = await user.page.evaluate(() =>
    [...document.querySelectorAll('section.stack > div.stack')].flatMap((group) =>
      [...group.querySelectorAll('a.game')].map((card) => ({
        category: group.querySelector('h2').textContent.trim(),
        name: card.querySelector('h3').textContent.trim(),
        players: card.querySelector('.meta').textContent.trim(),
        description: card.querySelector('p').textContent.trim(),
        href: card.getAttribute('href'),
      })),
    ),
  );
  assert.ok(shown.length >= 5, `at least the five original games are listed (found ${shown.length})`); // other agents may add modules
  for (const game of GAMES) {
    const card = shown.find((s) => s.name === game.name);
    assert.ok(card, `${game.name} is on the menu`);
    assert.equal(card.players, game.players, `${game.name} player count`);
    assert.equal(card.category, game.category, `${game.name} category`);
    assert.equal(card.href, `/play/${game.id}`);
    assert.ok(card.description.length > 20, `${game.name} has a description`);
  }
  // Within the page the groups come in the order the site lists them.
  const headings = await user.page.$$eval('section.stack h2', (els) => els.map((e) => e.textContent.trim()));
  for (const heading of ['Card games', 'Party games']) assert.ok(headings.includes(heading), `a ${heading} group`);
}));

for (const game of GAMES) {
  test(`${game.name}: the card opens the game page, and the Rules dialog works`, { timeout: 60000 }, guarded(`rules ${game.id}`, async () => {
    await user.goto('/');
    await user.waitForText('Choose a game.');
    await user.clickButton(game.name, { scope: 'main' });
    await user.waitForSelector('header.bar h1');
    assert.equal(user.url.pathname, `/play/${game.id}`);
    // The title and the Rules button live in the site header, not in the play area.
    assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), game.name);
    assert.equal(await user.page.$('.play h1'), null, 'no second title in the play area');

    // A distinctive line from the game's own rules.md must show in the dialog.
    const rules = fs.readFileSync(path.join(root, 'modules', game.id, 'rules.md'), 'utf8');
    const headings = rules.split(/\r?\n/).filter((l) => /^#{2,3} /.test(l)).map((l) => l.replace(/^#+\s*/, '').trim());
    assert.ok(headings.length >= 2, 'the rules have headings to look for');

    await user.clickButton('Rules', { exact: true, scope: 'header.bar' });
    const dialog = '[role="dialog"][aria-label="Rules"]';
    await user.waitForSelector(dialog);
    await user.waitForNoText('Loading…');
    const shown = await user.page.$eval(dialog, (e) => e.innerText);
    assert.match(shown, new RegExp(`${game.name}: rules`));
    for (const heading of headings.slice(0, 3)) assert.ok(shown.includes(heading), `the rules dialog shows "${heading}"`);

    // Esc closes it.
    await user.page.keyboard.press('Escape');
    await user.waitForSelector(dialog, { hidden: true, timeout: 3000 });

    // So does the Close button.
    await user.clickButton('Rules', { exact: true, scope: 'header.bar' });
    await user.waitForSelector(dialog);
    await user.clickButton('Close', { exact: true, scope: dialog });
    await user.waitForSelector(dialog, { hidden: true, timeout: 3000 });
  }));
}

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
