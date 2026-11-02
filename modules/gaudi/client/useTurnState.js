// What the view says about whose turn it is and what you may do now. Pure derivations from the server's view: it keeps no
// state of its own and sends nothing.
import { computed } from 'vue';
import { CELLS } from '../rules.js';
import { messageText } from '../../../src/messageText.js';

/**
 * The facts about the current phase and turn, as computed values.
 * @param {import('vue').ComputedRef<object>} s  the view sent by the server
 * @returns {object} windows, finished, me, myTurn, canPlace, pattern, waitingFor, turnNumber, poolMax, trackSlots, winners,
 *   nameOf(seat), poolDie(id), emptyGrid()
 * Side effects: none.
 */
export function useTurnState(s) {
  // Which phase the game is in.
  const windows = computed(() => s.value.phase === 'windows');
  const finished = computed(() => s.value.phase === 'finished');
  // Your own seat (null before you have one).
  const me = computed(() => s.value.seats[s.value.you] ?? null);
  // True only while playing and the turn belongs to you.
  const myTurn = computed(() => s.value.phase === 'playing' && s.value.turn?.seat === s.value.you);
  // You may still place a die this turn (an extra Swift Hand turn allows more).
  const canPlace = computed(() => myTurn.value && s.value.turn.placements < s.value.turn.allowed);
  // Your window's restrictions as { cells }, the shape rules.js checks placements against.
  const pattern = computed(() => (me.value?.window ? { cells: me.value.window.rows.join('').split('') } : null));
  // Names of the players who have not yet picked a window.
  const waitingFor = computed(() => s.value.seats.filter((seat) => seat && !seat.picked).map((seat) => seat.name));
  // Wording for which of the round's two turns this is.
  const turnNumber = computed(() => (s.value.turn?.number === 2 ? 'second' : 'first'));
  // The biggest the pool can be (two dice per player plus one), used to reserve its room.
  const poolMax = computed(() => 2 * (s.value.size ?? s.value.seats.length) + 1);
  // One entry per round: the dice left over from it, or null while it has not been played.
  const trackSlots = computed(() => Array.from({ length: s.value.limits.rounds }, (_, i) => s.value.track?.[i] ?? null));
  /**
   * The name of a seat for the Status box (the site's "Someone" if it is empty). It is words, not a message, because it
   * goes into sentences as a parameter; messageText is used rather than useGameText so that this stays a plain function
   * that can be called outside a component.
   * @param {number} seat  the seat number
   * @returns {string}
   * Side effects: none.
   */
  const nameOf = (seat) => s.value.seats[seat]?.name ?? messageText({ key: 'common.someone' });
  // The winners' names.
  const winners = computed(() => (s.value.winners ?? []).map(nameOf));
  /**
   * The die in the pool with this id, or null (it may have been placed or changed since the player clicked it).
   * @param {number} id  the die's id
   * @returns {object | null}
   * Side effects: none.
   */
  const poolDie = (id) => (s.value.pool ?? []).find((d) => d.id === id) ?? null;
  /**
   * An empty window's worth of spaces (used before the player has a window).
   * @returns {null[]} CELLS nulls
   * Side effects: none.
   */
  const emptyGrid = () => Array(CELLS).fill(null);
  return { windows, finished, me, myTurn, canPlace, pattern, waitingFor, turnNumber, poolMax, trackSlots, winners, nameOf, poolDie, emptyGrid };
}
