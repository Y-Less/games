// Lets any Dixnt component reach the game's store without prop drilling: the root component provides it under DIXNT_KEY.
import { inject } from 'vue';

/**
 * The key the root component provides the store under.
 * @type {symbol}
 * Side effects: none.
 */
export const DIXNT_KEY = Symbol('dixnt');

/**
 * Gets the game's store (see store.js), provided by the root component.
 * @returns {object} The object returned by createStore (undefined if no provider is above the caller).
 * Side effects: none (reads the injection context, so call it during component setup).
 */
export function useDixnt() {
  return inject(DIXNT_KEY);
}
