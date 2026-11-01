// The shop: what can be bought with coins, and who owns what. Free items (price 0) belong to everyone. Everything a
// player can choose on their profile (a background, a card back ...) is an item here, and the server refuses to save a
// choice the player does not own.
import { AuthError } from './errors.js';
import { BACKGROUND_PRESETS, CARD_BACK_PRESETS, EFFECT_INTENSITY, EFFECT_SPEED } from './profileSettings.js';
import { BACKGROUND_ANIMATIONS, NAME_ANIMATIONS } from '../shared/animations.js';
import { AVATAR_SLOTS, avatarItemId, avatarItems } from '../shared/avatar.js';
import { NAME_STYLES } from '../shared/nameStyles.js';
import { CUSTOM_MARKER_ITEM, isPresetMarker } from '../shared/markerColours.js';
import { SITE_FONTS, SITE_THEMES } from '../shared/siteThemes.js';
import { createCoins } from './coins.js';
import { transaction } from './db.js';

/** Items in the order the shop lists them: { id, type, name, price }. Add new kinds of item with `add`. */
const catalogue = [];
const byId = new Map();
/**
 * Puts an item in the catalogue.
 * @param {{ id: string, type: string, name: string, price: number }} item
 * @returns {void}
 * @throws {Error} when the id is already taken
 * Side effects: adds to the module's catalogue.
 */
function add(item) {
  if (byId.has(item.id)) throw new Error(`Duplicate shop item "${item.id}"`);
  catalogue.push(item);
  byId.set(item.id, item);
}

/**
 * Capitalises the first letter of a key.
 * @param {string} key
 * @returns {string}
 * Side effects: none.
 */
const titled = (key) => key[0].toUpperCase() + key.slice(1);
const BACKGROUND_PRICES = { night: 0, slate: 300, dusk: 500, forest: 500, ocean: 500, ember: 500 };
const CARD_BACK_PRICE = 300;

for (const key of Object.keys(BACKGROUND_PRESETS)) {
  add({ id: `bg:${key}`, type: 'background', name: titled(key), price: BACKGROUND_PRICES[key] ?? 500 });
}
add({ id: 'bg-colour', type: 'unlock', name: 'Any background colour', price: 800 });
add({ id: 'bg-gradient', type: 'unlock', name: 'Your own gradient', price: 1000 });
add({ id: 'bg-upload', type: 'unlock', name: 'Your own background picture', price: 2000 });
for (const key of Object.keys(CARD_BACK_PRESETS)) {
  add({ id: `cb:${key}`, type: 'card-back', name: titled(key), price: key === 'crimson' ? 0 : CARD_BACK_PRICE });
}
add({ id: 'fx-intensity', type: 'unlock', name: 'Background animation intensity slider', price: 600 });
add({ id: 'fx-speed', type: 'unlock', name: 'Background animation speed slider', price: 600 });
add({ id: CUSTOM_MARKER_ITEM, type: 'unlock', name: 'Any marker colour', price: 600 });
add({ id: 'cb-upload', type: 'unlock', name: 'Your own card back picture', price: 2000 });

for (const style of NAME_STYLES) add({ id: `ns:${style.id}`, type: 'name-style', name: style.name, price: style.price });
for (const a of NAME_ANIMATIONS) add({ id: `na:${a.id}`, type: 'name-animation', name: a.name, price: a.price, part: a.part });
for (const a of BACKGROUND_ANIMATIONS) if (!a.hidden) add({ id: `ba:${a.id}`, type: 'background-animation', name: a.name, price: a.price });
for (const t of SITE_THEMES) add({ id: `st:${t.id}`, type: 'site-theme', name: t.name, price: t.price, colours: t.vars });
for (const f of SITE_FONTS) add({ id: `sf:${f.id}`, type: 'site-font', name: f.name, price: f.price, display: f.display, body: f.body });
for (const { id, name, price, slot, option } of avatarItems()) add({ id, type: 'avatar', name, price, slot, option });

/**
 * An item by id.
 * @param {string} id
 * @returns {object | null}
 * Side effects: none.
 */
export const itemById = (id) => byId.get(id) ?? null;

/**
 * The part of the shop an item belongs to: its type, except that avatar parts are split by slot ("avatar:hair"), so
 * each kind of part has its own place in the shop.
 * @param {{ type: string, slot?: string }} item
 * @returns {string}
 * Side effects: none.
 */
export const categoryOf = (item) => (item.type === 'avatar' ? `avatar:${item.slot}` : item.type);

/**
 * The parts of the shop that sell something: those with at least one item that costs coins.
 * @returns {string[]}
 * Side effects: none.
 */
export const paidCategories = () => [...new Set(catalogue.filter((item) => item.price > 0).map(categoryOf))];
/**
 * Every item, in shop order.
 * @returns {object[]}  a copy of the catalogue
 * Side effects: none.
 */
export const allItems = () => catalogue.slice();

/**
 * The item that a saved background setting needs, or null when it needs nothing.
 * @param {object} background  a saved background setting
 * @returns {string | null}  an item id
 * Side effects: none.
 */
export function itemForBackground(background) {
  if (background?.type === 'preset') return `bg:${background.value}`;
  if (background?.type === 'colour') return 'bg-colour';
  if (background?.type === 'gradient') return 'bg-gradient';
  if (background?.type === 'image') return 'bg-upload';
  return null;
}

/**
 * The item that a saved card-back setting needs.
 * @param {object} cardBack  a saved card-back setting
 * @returns {string}  an item id
 * Side effects: none.
 */
export const itemForCardBack = (cardBack) => (cardBack?.type === 'image' ? 'cb-upload' : `cb:${cardBack?.value}`);

/**
 * Whether a user may use an item: it is free, or they have bought it. An unknown item is never owned.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {string} itemId
 * @returns {boolean}
 * Side effects: none.
 */
export function owns(db, userId, itemId) {
  const item = byId.get(itemId);
  if (!item) return false;
  if (item.price === 0) return true;
  return Boolean(db.prepare('SELECT 1 FROM owned_items WHERE user_id = ? AND item_id = ?').get(userId, itemId));
}

/**
 * Gives every user the items their current settings need, so introducing the shop takes nothing away from anyone.
 * Safe to run on every start: it only adds what is missing.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {void}
 * Side effects: inserts owned_items rows.
 */
export function grandfather(db) {
  const grant = db.prepare('INSERT OR IGNORE INTO owned_items (user_id, item_id, bought_at) VALUES (?, ?, ?)');
  // Parses stored JSON text; returns the value, or null when it is damaged (never throws).
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  for (const row of db.prepare('SELECT id, background, card_back FROM users').all()) {
    for (const itemId of [itemForBackground(parse(row.background)), itemForCardBack(parse(row.card_back))]) {
      if (itemId && byId.has(itemId) && byId.get(itemId).price > 0) grant.run(row.id, itemId, Date.now());
    }
  }
}

/** A refused shop request; an AuthError, so the site turns it into a JSON reply with its status. */
export class ShopError extends AuthError {}

/**
 * How many of the things you can put on from the shop a profile change swapped for something else (a background, a card
 * back, a name style, a name animation, each avatar part, a site colour, a font, a background animation). `before` and
 * `after` are users as the site shows them.
 * @param {object} before
 * @param {object} after
 * @returns {number}
 * Side effects: none.
 */
export function choicesChanged(before, after) {
  // Whether two choices differ (null and undefined count as the same); returns a boolean.
  const differs = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  // The list of shop-relevant choices a user has put on; returns an array to compare position by position.
  const choices = (user) => [user.background, user.cardBack, user.nameStyle?.style, user.nameStyle?.animation, user.siteTheme, user.siteFont, user.backgroundAnimation, ...AVATAR_SLOTS.map(({ slot }) => user.avatar?.[slot])];
  const was = choices(before);
  return choices(after).filter((choice, i) => differs(choice, was[i])).length;
}

/**
 * Refuses a profile change that uses something the user has not bought (startSite hands it to createAuth as its `canUse`).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {object} settings  the cleaned settings of the change (see profile.js SETTINGS)
 * @returns {void}
 * @throws {ShopError} 403 naming the first item that must be bought
 * Side effects: none.
 */
export function checkSettings(db, userId, { background, cardBack, nameStyle, avatar, markerColour, siteTheme, siteFont, backgroundAnimation, effectIntensity, effectSpeed }) {
  const parts = avatar ? AVATAR_SLOTS.map(({ slot }) => avatarItemId(slot, avatar[slot])) : [];
  for (const itemId of [background && itemForBackground(background), cardBack && itemForCardBack(cardBack), markerColour && !isPresetMarker(markerColour) && CUSTOM_MARKER_ITEM, nameStyle && `ns:${nameStyle.style}`, nameStyle && `na:${nameStyle.animation ?? 'none'}`, backgroundAnimation && `ba:${backgroundAnimation}`, siteTheme && `st:${siteTheme}`, siteFont && `sf:${siteFont}`, effectIntensity !== undefined && effectIntensity !== EFFECT_INTENSITY.normal && 'fx-intensity', effectSpeed !== undefined && effectSpeed !== EFFECT_SPEED.normal && 'fx-speed', ...parts]) {
    if (itemId && !owns(db, userId, itemId)) throw new ShopError(`You need to buy "${byId.get(itemId)?.name ?? 'that'}" in the shop first.`, 403);
  }
}

/**
 * The shop's operations on a database.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ owns: Function, customised: Function, listing: Function, buy: Function }}
 * Side effects: none until a method is called.
 */
export function createShop(db) {
  const coins = createCoins(db);
  return {
    // Whether a user owns a shop item (see owns()); returns a boolean. Side effects: none.
    owns: (userId, itemId) => owns(db, userId, itemId),

    /**
     * 1 once the user owns something that cost coins from every part of the shop (see paidCategories), else 0.
     * @param {number} userId
     * @returns {0 | 1}
     * Side effects: none.
     */
    customised(userId) {
      const bought = new Set(
        db
          .prepare('SELECT item_id FROM owned_items WHERE user_id = ?')
          .all(userId)
          .flatMap((row) => (byId.get(row.item_id)?.price > 0 ? [categoryOf(byId.get(row.item_id))] : [])),
      );
      return paidCategories().every((category) => bought.has(category)) ? 1 : 0;
    },

    /**
     * Everything on sale, with whether this user owns each item, and their balance.
     * @param {number} userId
     * @returns {{ balance: number, items: object[] }}
     * Side effects: none.
     */
    listing(userId) {
      const owned = new Set(db.prepare('SELECT item_id FROM owned_items WHERE user_id = ?').all(userId).map((r) => r.item_id));
      return {
        balance: coins.balance(userId),
        items: catalogue.map((item) => ({ ...item, category: categoryOf(item), owned: item.price === 0 || owned.has(item.id) })),
      };
    },

    /**
     * Buys an item for the user. Refuses unknown items, items already owned, and prices they cannot afford.
     * @param {number} userId
     * @param {string} itemId
     * @returns {{ item: object, balance: number }}
     * @throws {ShopError} 404 unknown item, 409 already owned, 402 not enough gold
     * Side effects: spends coins and records the purchase, in one transaction.
     */
    buy(userId, itemId) {
      const item = typeof itemId === 'string' ? byId.get(itemId) : null;
      if (!item) throw new ShopError('There is no such item.', 404);
      return transaction(db, () => {
        if (owns(db, userId, itemId)) throw new ShopError('You already have that.', 409);
        if (coins.balance(userId) < item.price) throw new ShopError('You do not have enough gold for that.', 402);
        coins.spend(userId, item.price, `shop:${item.id}`);
        db.prepare('INSERT INTO owned_items (user_id, item_id, bought_at) VALUES (?, ?, ?)').run(userId, item.id, Date.now());
        return { item, balance: coins.balance(userId) };
      });
    },
  };
}
