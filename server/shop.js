// The shop: what can be bought with coins, and who owns what. Free items (price 0) belong to everyone. Everything a
// player can choose on their profile (a background, a card back ...) is an item here, and the server refuses to save a
// choice the player does not own.
import { AuthError, BACKGROUND_PRESETS, CARD_BACK_PRESETS, EFFECT_INTENSITY, EFFECT_SPEED } from './auth.js';
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
function add(item) {
  if (byId.has(item.id)) throw new Error(`Duplicate shop item "${item.id}"`);
  catalogue.push(item);
  byId.set(item.id, item);
}

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

/** Another module adds its own items (name styles, avatar parts ...) here once, when the site starts. */
export const registerItems = (items) => items.forEach(add);

export const itemById = (id) => byId.get(id) ?? null;

/**
 * The part of the shop an item belongs to: its type, except that avatar parts are split by slot ("avatar:hair"), so
 * each kind of part has its own place in the shop.
 */
export const categoryOf = (item) => (item.type === 'avatar' ? `avatar:${item.slot}` : item.type);

/** The parts of the shop that sell something: those with at least one item that costs coins. */
export const paidCategories = () => [...new Set(catalogue.filter((item) => item.price > 0).map(categoryOf))];
export const allItems = () => catalogue.slice();

/** The item that a saved background setting needs, or null when it needs nothing. */
export function itemForBackground(background) {
  if (background?.type === 'preset') return `bg:${background.value}`;
  if (background?.type === 'colour') return 'bg-colour';
  if (background?.type === 'gradient') return 'bg-gradient';
  if (background?.type === 'image') return 'bg-upload';
  return null;
}

/** The item that a saved card-back setting needs. */
export const itemForCardBack = (cardBack) => (cardBack?.type === 'image' ? 'cb-upload' : `cb:${cardBack?.value}`);

/** Whether a user may use an item: it is free, or they have bought it. An unknown item is never owned. */
export function owns(db, userId, itemId) {
  const item = byId.get(itemId);
  if (!item) return false;
  if (item.price === 0) return true;
  return Boolean(db.prepare('SELECT 1 FROM owned_items WHERE user_id = ? AND item_id = ?').get(userId, itemId));
}

/**
 * Gives every user the items their current settings need, so introducing the shop takes nothing away from anyone.
 * Safe to run on every start: it only adds what is missing.
 */
export function grandfather(db) {
  const grant = db.prepare('INSERT OR IGNORE INTO owned_items (user_id, item_id, bought_at) VALUES (?, ?, ?)');
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

/** Refuses a profile change that uses something the user has not bought (given to createAuth as its `canUse`). */
export function checkSettings(db, userId, { background, cardBack, nameStyle, avatar, markerColour, siteTheme, siteFont, backgroundAnimation, effectIntensity, effectSpeed }) {
  const parts = avatar ? AVATAR_SLOTS.map(({ slot }) => avatarItemId(slot, avatar[slot])) : [];
  for (const itemId of [background && itemForBackground(background), cardBack && itemForCardBack(cardBack), markerColour && !isPresetMarker(markerColour) && CUSTOM_MARKER_ITEM, nameStyle && `ns:${nameStyle.style}`, nameStyle && `na:${nameStyle.animation ?? 'none'}`, backgroundAnimation && `ba:${backgroundAnimation}`, siteTheme && `st:${siteTheme}`, siteFont && `sf:${siteFont}`, effectIntensity !== undefined && effectIntensity !== EFFECT_INTENSITY.normal && 'fx-intensity', effectSpeed !== undefined && effectSpeed !== EFFECT_SPEED.normal && 'fx-speed', ...parts]) {
    if (itemId && !owns(db, userId, itemId)) throw new ShopError(`You need to buy "${byId.get(itemId)?.name ?? 'that'}" in the shop first.`, 403);
  }
}

export function createShop(db) {
  const coins = createCoins(db);
  return {
    owns: (userId, itemId) => owns(db, userId, itemId),

    /** 1 once the user owns something that cost coins from every part of the shop (see paidCategories), else 0. */
    customised(userId) {
      const bought = new Set(
        db
          .prepare('SELECT item_id FROM owned_items WHERE user_id = ?')
          .all(userId)
          .flatMap((row) => (byId.get(row.item_id)?.price > 0 ? [categoryOf(byId.get(row.item_id))] : [])),
      );
      return paidCategories().every((category) => bought.has(category)) ? 1 : 0;
    },

    /** Everything on sale, with whether this user owns each item, and their balance. */
    listing(userId) {
      const owned = new Set(db.prepare('SELECT item_id FROM owned_items WHERE user_id = ?').all(userId).map((r) => r.item_id));
      return {
        balance: coins.balance(userId),
        items: catalogue.map((item) => ({ ...item, category: categoryOf(item), owned: item.price === 0 || owned.has(item.id) })),
      };
    },

    /** Buys an item for the user. Refuses unknown items, items already owned, and prices they cannot afford. */
    buy(userId, itemId) {
      const item = typeof itemId === 'string' ? byId.get(itemId) : null;
      if (!item) throw new ShopError('There is no such item.', 404);
      return transaction(db, () => {
        if (owns(db, userId, itemId)) throw new ShopError('You already have that.', 409);
        if (coins.balance(userId) < item.price) throw new ShopError('You do not have enough coins for that.', 402);
        coins.spend(userId, item.price, `shop:${item.id}`);
        db.prepare('INSERT INTO owned_items (user_id, item_id, bought_at) VALUES (?, ?, ?)').run(userId, item.id, Date.now());
        return { item, balance: coins.balance(userId) };
      });
    },
  };
}
