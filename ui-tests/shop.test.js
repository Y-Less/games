// The shop, as somebody with a new account meets it: the catalogue and what it costs, being refused what they cannot
// afford, buying a background and a card back with Gilders and watching the balance fall, putting them on with Use,
// and finding them chosen on the Profile page, where what has not been bought stays locked.
//
// Every other UI test runs in a world where each account owns everything on sale; this one is the world as it really
// is (`shopLocked`), so it is the one place the journey from Gilders to a new look is walked through the screen.  The
// prices come from the catalogue (server/shop.js) and the Gilders an achievement pays from shared/achievements.js, so
// every balance below is worked out and none is copied off the page.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';
import { allItems, itemById } from '../server/shop.js';
import { GLOBAL_ACHIEVEMENTS, levelReward } from '../shared/achievements.js';

/** The Gilders that reaching `level` of one of the site's achievements pays. */
const pays = (key, level) => levelReward(level, GLOBAL_ACHIEVEMENTS.find((achievement) => achievement.key === key).levels.length);
const WELCOME = pays('welcome', 1); // "Sign up": every new account starts with this
const FIRST_PURCHASE = pays('fashionable', 1); // "Buy something in the shop"
const WINNINGS = 700; // what the test hands over, as if from a few games won (100 for coming 1st, src/help/en/shop.md)
const SLATE = itemById('bg:slate');
const OCEAN = itemById('bg:ocean');
const NAVY = itemById('cb:navy');
const FOREST = itemById('cb:forest');
const GOLD = itemById('cb:gold');
const TABS = ['Names', 'Backgrounds', 'Themes', 'Card backs', 'Avatar', 'Unlocks']; // the sections of src/help/en/shop.md

let world;
let user;
let userId;
let config;
before(async () => {
  world = await createWorld({ suite: 'shop', shopLocked: true });
  user = await world.newUser('shopper');
  await user.signUp('shop', { displayName: 'Penny' });
  userId = world.site.db.prepare('SELECT id FROM users WHERE username = ?').get(user.username).id;
  config = await user.api('GET', '/api/config');
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
/** Waits for something in the page to be so, with the wait a loaded machine needs. */
const until = (what, check, ...args) =>
  user.page.waitForFunction(check, { timeout: 30000, polling: 50 }, ...args).catch(async (error) => {
    throw new Error(`timed out waiting for ${what}.  The page says:\n${(await user.text()).slice(0, 1200)}\n(${error.message})`);
  });
/** Opens a tab of the shop by its address and waits for the listing. */
async function openShop(tab) {
  await user.goto(`/shop/${tab}`);
  await user.waitForSelector('.shop .items .item');
}
/** Waits for the shop's own Gilder count, and the one in the site header, to say this. */
async function balanceIs(amount) {
  await until(`the shop to show ${amount} Gilders`, (wanted) => document.querySelector('.shop .coins strong')?.textContent.trim() === wanted, String(amount));
  await until(`the header to show ${amount} Gilders`, (wanted) => document.querySelector('header a.coins')?.textContent.trim() === wanted, String(amount));
}
/** What an item's box in the shop shows: its name, its Buy button if it has one, its Use button, and its state line. */
const box = (item) =>
  user.page.$eval(`[data-item="${item.id}"]`, (el) => {
    const buttons = [...el.querySelectorAll('button')].map((button) => ({ text: button.textContent.trim(), disabled: button.disabled, title: button.getAttribute('title') }));
    return {
      name: el.querySelector('.name').textContent.trim(),
      buy: buttons.find((button) => button.text.startsWith('Buy for')) ?? null,
      use: buttons.find((button) => button.text === 'Use') ?? null,
      state: el.querySelector('.state')?.textContent.trim() ?? null,
      on: el.classList.contains('on'),
    };
  });
/** Waits for an item's box to be offering Use, or to say this in its state line. */
const boxSays = (item, wanted) =>
  until(
    `${item.name} to say "${wanted}"`,
    (id, text) => {
      const el = document.querySelector(`[data-item="${id}"]`);
      if (!el) return false;
      return text === 'Use' ? [...el.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Use') : el.querySelector('.state')?.textContent.trim() === text;
    },
    item.id,
    wanted,
  );
/** The Gilders the server has written down for this account, as the amounts for one reason. */
const ledger = (reason) => world.site.db.prepare('SELECT amount FROM coin_ledger WHERE user_id = ? AND reason = ?').all(userId, reason).map((row) => row.amount);
/** One of the Profile page's preset swatches. */
const swatch = (label) => user.page.$eval(`button[aria-label="${label}"]`, (el) => ({ disabled: el.disabled, pressed: el.getAttribute('aria-pressed'), title: el.getAttribute('title') }));
async function openProfile() {
  await user.goto('/profile');
  await user.waitForText('Card back');
  await user.waitForSelector('button[aria-label="slate background"]');
  // The swatches are locked from the shop's listing, so wait for it to have arrived (the header's count comes with it).
  await user.waitForSelector('header a.coins');
}

test('the prices this journey is built on are what it takes them to be', () => {
  // The journey below needs a background the welcome Gilders do not stretch to, and three card backs at one price.
  assert.ok(SLATE.price > WELCOME, 'the cheapest thing bought here costs more than signing up pays');
  assert.ok(OCEAN.price > 0 && NAVY.price > 0);
  assert.equal(FOREST.price, NAVY.price);
  assert.equal(GOLD.price, NAVY.price);
  assert.ok(WELCOME + WINNINGS + FIRST_PURCHASE >= SLATE.price + NAVY.price + FOREST.price, 'the winnings pay for all three');
  assert.ok(WELCOME + WINNINGS + FIRST_PURCHASE < SLATE.price + NAVY.price + FOREST.price + GOLD.price, 'and not for a fourth');
});

test('a new account has the Gilders that signing up pays, and the shop lists the catalogue with its prices', { timeout: 60000 }, guarded('catalogue', async () => {
  await user.goto('/shop');
  await user.waitForSelector('.shop .items .item');
  assert.equal(await user.page.$eval('.shop h1', (el) => el.textContent.trim()), 'Shop');
  await balanceIs(WELCOME);
  assert.equal(await user.page.$eval('header a.coins', (el) => el.getAttribute('title')), `${WELCOME} Gilders: spend them in the shop`);
  assert.deepEqual(await user.page.$$eval('.shop .tabs .tab', (els) => els.map((el) => el.textContent.trim())), TABS);

  // Each tab has an address of its own.
  await user.clickButton('Backgrounds', { exact: true, scope: '.shop .tabs' });
  await user.waitForSelector('[data-item="bg:night"]');
  assert.equal(user.url.pathname, '/shop/backgrounds');
  assert.deepEqual(await user.page.$$eval('.shop .group-title', (els) => els.map((el) => el.textContent.trim())), ['Pictures', 'Animations']);

  // Every background picture in the catalogue is there, in the catalogue's order, at the catalogue's price; what is
  // free is yours already, and nothing else is.
  const pictures = allItems().filter((item) => item.type === 'background');
  assert.deepEqual(await user.page.$$eval('.shop .group:first-of-type [data-item]', (els) => els.map((el) => el.dataset.item)), pictures.map((item) => item.id));
  for (const item of pictures) {
    const shown = await box(item);
    assert.equal(shown.name, item.name);
    if (item.price > 0) {
      assert.equal(shown.buy?.text, `Buy for ${item.price}`, `${item.name} is for sale at its price`);
      assert.equal(shown.use, null, `${item.name} cannot be used before it is bought`);
    } else {
      assert.equal(shown.buy, null, `${item.name} is free, so there is nothing to buy`);
    }
  }
  // The free background is the one a new account starts on.
  const night = await box(itemById('bg:night'));
  assert.equal(night.state, 'In use');
  assert.equal(night.on, true);
}));

test('what cannot be afforded is refused: by the button, by the server, and on the Profile page', { timeout: 60000 }, guarded('refused', async () => {
  await openShop('backgrounds');
  await balanceIs(WELCOME);
  const slate = await box(SLATE);
  assert.equal(slate.buy.disabled, true, 'the Buy button cannot be pressed');
  assert.equal(slate.buy.title, `You need ${SLATE.price - WELCOME} more Gilders`);

  // Asking the server directly gets the same answer, and costs nothing.
  assert.deepEqual(await user.api('POST', '/api/shop/buy', { item: SLATE.id }), { error: 'notEnoughGold' });
  assert.equal((await user.api('PATCH', '/api/me', { background: { type: 'preset', value: 'slate' } })).error, 'notOwned', 'nor can it be put on without being bought');
  await openShop('backgrounds');
  await balanceIs(WELCOME);
  assert.equal((await box(SLATE)).buy.text, `Buy for ${SLATE.price}`, 'it is still for sale');

  // The Profile page shows it locked, and says where to get it.
  await openProfile();
  await until('the slate swatch to be locked', () => document.querySelector('button[aria-label="slate background"]')?.disabled === true);
  assert.equal((await swatch('slate background')).title, 'slate: buy it in the shop');
  assert.deepEqual(await swatch('night background'), { disabled: false, pressed: 'true', title: 'night' });
}));

test('buying takes the price off the balance, and the first purchase pays for itself a little', { timeout: 60000 }, guarded('buying', async () => {
  // Gilders are won at the table (100 for coming 1st, 50 for 2nd, 20 for 3rd): here they are simply written into the ledger.
  world.site.db.prepare("INSERT INTO coin_ledger (user_id, amount, reason, created_at) VALUES (?, ?, 'test:winnings', 0)").run(userId, WINNINGS);
  await openShop('backgrounds');
  await balanceIs(WELCOME + WINNINGS);
  const before = await box(SLATE);
  assert.deepEqual(before.buy, { text: `Buy for ${SLATE.price}`, disabled: false, title: null }, 'it can be afforded now');

  await user.clickButton(`Buy for ${SLATE.price}`, { exact: true, scope: `[data-item="${SLATE.id}"]` });
  await boxSays(SLATE, 'Use');
  // The price comes off, and "Fashionable" (buy something in the shop) pays its first level at once.
  await balanceIs(WELCOME + WINNINGS - SLATE.price + FIRST_PURCHASE);
  assert.equal((await box(SLATE)).buy, null, 'what is owned is not for sale again');
  assert.deepEqual(ledger(`shop:${SLATE.id}`), [-SLATE.price], 'the price was taken once');
  assert.equal(await user.page.$('.shop .bad'), null, 'and nothing was complained of');
  // Buying it is not wearing it: the background has not changed yet.
  assert.equal((await user.vars()).siteBg, config.backgrounds.night);
  assert.equal((await box(OCEAN)).buy.text, `Buy for ${OCEAN.price}`, 'the others are still for sale');
}));

test('Use puts it on, the site changes at once, and the Profile page shows it chosen', { timeout: 60000 }, guarded('wearing', async () => {
  await openShop('backgrounds');
  await user.clickButton('Use', { exact: true, scope: `[data-item="${SLATE.id}"]` });
  await boxSays(SLATE, 'In use');
  assert.equal((await box(SLATE)).on, true);
  await boxSays(itemById('bg:night'), 'Use'); // the one it replaced can be gone back to
  assert.equal((await user.vars()).siteBg, config.backgrounds.slate);
  assert.notEqual(config.backgrounds.slate, config.backgrounds.night);

  await openProfile();
  await until('the slate swatch to be the chosen one', () => document.querySelector('button[aria-label="slate background"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(await swatch('slate background'), { disabled: false, pressed: 'true', title: 'slate' });
  assert.equal((await swatch('night background')).pressed, 'false');
  assert.deepEqual(await swatch('ocean background'), { disabled: true, pressed: 'false', title: 'ocean: buy it in the shop' }, 'what has not been bought is still locked');
  assert.equal((await user.vars()).siteBg, config.backgrounds.slate, 'still on after the page was loaded afresh');
}));

test('a second purchase costs exactly its price, and a card back is worn the same way', { timeout: 60000 }, guarded('second purchase', async () => {
  const had = WELCOME + WINNINGS - SLATE.price + FIRST_PURCHASE;
  await openShop('card-backs');
  await balanceIs(had);
  await user.clickButton(`Buy for ${NAVY.price}`, { exact: true, scope: `[data-item="${NAVY.id}"]` });
  await boxSays(NAVY, 'Use');
  await balanceIs(had - NAVY.price);
  assert.deepEqual(ledger(`shop:${NAVY.id}`), [-NAVY.price]);

  await user.clickButton('Use', { exact: true, scope: `[data-item="${NAVY.id}"]` });
  await boxSays(NAVY, 'In use');
  assert.equal((await user.vars()).cardBack, config.cardBacks.navy);
  await openProfile();
  await until('the navy card back to be the chosen one', () => document.querySelector('button[aria-label="navy card back"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal((await swatch('forest card back')).disabled, true, 'a card back that has not been bought is locked');
}));

test('Gilders spent somewhere else are gone: the purchase is refused in words, and nothing is taken', { timeout: 60000 }, guarded('spent elsewhere', async () => {
  const had = WELCOME + WINNINGS - SLATE.price + FIRST_PURCHASE - NAVY.price;
  await openShop('card-backs');
  await balanceIs(had);
  assert.equal((await box(GOLD)).buy.disabled, false, 'the page believes there is enough');
  // The same account buys something from another window, which this page has not heard about.
  assert.equal((await user.api('POST', '/api/shop/buy', { item: FOREST.id })).balance, had - FOREST.price);
  await user.clickButton(`Buy for ${GOLD.price}`, { exact: true, scope: `[data-item="${GOLD.id}"]` });
  await user.waitForSelector('.shop .bad[role="alert"]');
  assert.equal(await user.page.$eval('.shop .bad', (el) => el.textContent.trim()), 'You do not have enough Gilders for that.');
  assert.deepEqual(ledger(`shop:${GOLD.id}`), [], 'nothing was taken for it');

  // Looked at afresh, the shop has caught up: what was bought elsewhere is owned, and the rest is out of reach.
  await openShop('card-backs');
  await balanceIs(had - FOREST.price);
  await boxSays(FOREST, 'Use');
  const gold = await box(GOLD);
  assert.equal(gold.buy.disabled, true);
  assert.equal(gold.buy.title, `You need ${GOLD.price - (had - FOREST.price)} more Gilders`);
  // And nothing can be bought twice.
  assert.deepEqual(await user.api('POST', '/api/shop/buy', { item: SLATE.id }), { error: 'alreadyOwned' });
  await openShop('card-backs');
  await balanceIs(had - FOREST.price);
}));

test('nothing in the page went wrong along the way', () => {
  assert.deepEqual(world.pageErrors, []);
});
