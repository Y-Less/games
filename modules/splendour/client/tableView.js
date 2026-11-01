// What the Splendour table knows about the game from the server's view, for the player looking at it: whose turn it is, what
// they hold, what a card costs them. Nothing here changes anything; every value follows the state it is given.
import { computed } from 'vue';
import { CARD_BY_ID } from '../cards.js';
import { needOf as costAfterBonuses } from '../rules.js';

/**
 * Adds up a list of numbers.
 *
 * @param {number[]} list  the numbers
 * @returns {number} their total
 */
export const sum = (list) => list.reduce((a, b) => a + b, 0);

/**
 * The facts about the game that the whole table shares.
 *
 * @param {() => object} getState  returns the current server view (read inside computed values, so it stays reactive)
 * @returns {object} computed values: s, finished, me, turnIsMine, pendingMine, myTurn, bonuses, tokens, supply; and the
 *   functions nameOf(seat) and needOf(cardId)
 */
export function useTableView(getState) {
  const s = computed(getState);
  const finished = computed(() => s.value.phase === 'finished');
  const me = computed(() => s.value.seats[s.value.you] ?? null);
  const turnIsMine = computed(() => s.value.phase === 'playing' && s.value.turn === s.value.you);
  const pendingMine = computed(() => (s.value.pending && s.value.pending.seat === s.value.you ? s.value.pending : null));
  const myTurn = computed(() => turnIsMine.value && !s.value.pending);
  const bonuses = computed(() => me.value?.bonuses ?? [0, 0, 0, 0, 0]);
  const tokens = computed(() => me.value?.tokens ?? [0, 0, 0, 0, 0, 0]);
  const supply = computed(() => s.value.supply);

  /**
   * The name of a seat, or "Someone" when it is empty.
   *
   * @param {number} seat  a seat number
   * @returns {string} the player's name
   */
  const nameOf = (seat) => s.value.seats[seat]?.name ?? 'Someone';
  /**
   * What a card costs this player after their discounts (the shared calculation in rules.js).
   *
   * @param {string} id  a card id
   * @returns {number[]} five counts
   */
  const needOf = (id) => costAfterBonuses(CARD_BY_ID[id], bonuses.value);

  return { s, finished, me, turnIsMine, pendingMine, myTurn, bonuses, tokens, supply, nameOf, needOf };
}
