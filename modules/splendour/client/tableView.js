// What the Splendour table knows about the game from the server's view, for the player looking at it: whose turn it is, what
// they hold, what a card costs them.  Nothing here changes anything; every value follows the state it is given.
import { computed } from 'vue';
import { msg } from '../../../shared/messages.js';
import { CARD_BY_ID } from '../cards.js';
import { needOf as costAfterBonuses } from '../rules.js';

/**
 * Adds up a list of numbers.
 *
 * @param {number[]} list  the numbers
 * @returns {number} their total
 * Side effects: none.
 */
export const sum = (list) => list.reduce((a, b) => a + b, 0);

/**
 * The facts about the game that the whole table shares.
 *
 * @param {() => object} getState  returns the current server view (read inside computed values, so it stays reactive)
 * @returns {object} computed values: s, finished, me, turnIsMine, pendingMine, myTurn, bonuses, tokens, supply; and the
 *   functions nameOf(seat) and needOf(cardId)
 *
 * Side effects: none (creates computed values only).
 */
export function useTableView(getState) {
  // The current server view.
  const s = computed(getState);
  // True once the game is over.
  const finished = computed(() => s.value.phase === 'finished');
  // Your own seat, or null if you have none.
  const me = computed(() => s.value.seats[s.value.you] ?? null);
  // True when the game is on and it is your turn (a pending choice may still be open).
  const turnIsMine = computed(() => s.value.phase === 'playing' && s.value.turn === s.value.you);
  // The choice the server is waiting for you to make (return tokens, pick a noble), or null.
  const pendingMine = computed(() => (s.value.pending && s.value.pending.seat === s.value.you ? s.value.pending : null));
  // True when it is your turn and nothing is pending, i.e. you may take, buy, or reserve.
  const myTurn = computed(() => turnIsMine.value && !s.value.pending);
  // Your discounts, one per gem colour.
  const bonuses = computed(() => me.value?.bonuses ?? [0, 0, 0, 0, 0]);
  // Your tokens, one per colour with Gold last.
  const tokens = computed(() => me.value?.tokens ?? [0, 0, 0, 0, 0, 0]);
  // The tokens left in the supply, in the same order.
  const supply = computed(() => s.value.supply);

  /**
   * The name of a seat, or the site's "Someone" (as a message) when it is empty.
   *
   * @param {number} seat  a seat number
   * @returns {string | { key: string }} the player's name, or a message for an empty seat
   * Side effects: none.
   */
  const nameOf = (seat) => s.value.seats[seat]?.name ?? msg('common.someone');
  /**
   * What a card costs this player after their discounts (the shared calculation in rules.js).
   *
   * @param {string} id  a card id
   * @returns {number[]} five counts, one per gem colour
   * Side effects: none.
   */
  const needOf = (id) => costAfterBonuses(CARD_BY_ID[id], bonuses.value);

  return { s, finished, me, turnIsMine, pendingMine, myTurn, bonuses, tokens, supply, nameOf, needOf };
}
