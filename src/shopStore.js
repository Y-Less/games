// The shop as the client knows it: the listing and your coin balance (kept in session.shop), what you own, and buying.
import { api } from './api.js';
import { session } from './sessionState.js';

/**
 * Fetches the shop's listing and your coin balance (call again after anything that can change them).
 * @returns {Promise<void>}
 * Side effects: sets session.shop; on failure the balance and locks just stay as they were.
 */
export async function refreshShop() {
  if (!session.user) return;
  try {
    session.shop = await api('GET', '/api/shop');
  } catch {
    // the balance and locks just stay as they were
  }
}

/**
 * Whether you may use an item: true for anything not known to be for sale (before the listing has arrived, nothing is locked).
 * @param {string} itemId
 * @returns {boolean}
 * Side effects: none.
 */
export function owns(itemId) {
  const item = session.shop?.items.find((i) => i.id === itemId);
  return item ? item.owned : true;
}

/**
 * Buys an item with coins.
 * @param {string} itemId
 * @returns {Promise<void>}
 * @throws {Error} with the server's reason (not enough coins ...)
 * Side effects: spends coins on the server and refreshes session.shop.
 */
export async function buy(itemId) {
  await api('POST', '/api/shop/buy', { item: itemId });
  await refreshShop();
}
