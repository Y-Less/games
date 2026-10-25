import { inject } from 'vue';

export const DIXNT_KEY = Symbol('dixnt');

/** The game's store (see store.js), provided by the root component. */
export function useDixnt() {
  return inject(DIXNT_KEY);
}
