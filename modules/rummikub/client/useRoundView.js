// What the Rummikub table knows about the game from the server's view, for the player looking at it: the settings, the phase,
// whose turn it is, who is ready between rounds.  Nothing here changes anything.
import { computed } from 'vue';
import { dealSize } from '../rules.js';
import { msg } from '../../../shared/messages.js';

/**
 * The facts about the round that the whole table shares.
 * Each is a computed value, so components re-render only when the part of the view they read changes.
 *
 * Side effects: none (computed values only; nothing is mutated, emitted, or listened to).
 *
 * @param {() => object} getState  returns the current server view (read inside computed values, so it stays reactive)
 * @returns {object} computed values: state, s (the settings), finished, between, me, myTurn, melded, isHost, readyNames,
 *   waitingNames, scorePlayers, youReady, hand; and the function nameOf(seat)
 */
export function useRoundView(getState) {
  // The server view itself.
  const state = computed(getState);
  // The game settings (meld size, colours, and so on).
  const s = computed(() => state.value.settings);
  // True once the whole game is over.
  const finished = computed(() => state.value.phase === 'finished');
  // True while a round is over and players are reading the scores.
  const between = computed(() => state.value.phase === 'between');
  // Your seat's record, or null for a spectator.
  const me = computed(() => state.value.seats[state.value.you] ?? null);
  // True only while a round is in play, it is your seat's turn and you are seated (you is -1 for a spectator).
  const myTurn = computed(() => state.value.phase === 'playing' && state.value.turn === state.value.you && state.value.you !== -1);
  // True once you have made your first meld.
  const melded = computed(() => Boolean(me.value?.melded));
  // True if you are the host.
  const isHost = computed(() => state.value.hostSeat === state.value.you);
  // Names of the human players who have closed the scores (bots never need to).
  const readyNames = computed(() => state.value.seats.filter((x) => x && !x.bot && x.ready).map((x) => x.name));
  // Names of the human players the next round is waiting for; empty outside the between-rounds pause.
  const waitingNames = computed(() => (between.value ? state.value.seats.filter((x) => x && !x.bot && !x.ready).map((x) => x.name) : []));
  // The scoreboard's players, each with a `ready` flag (bots always count as ready) for the score bar.
  const scorePlayers = computed(() => state.value.scoreboard.players.map((p) => ({ ...p, ready: between.value && Boolean(state.value.seats[p.id]?.bot || state.value.seats[p.id]?.ready) })));
  // True if you have already closed the scores.
  const youReady = computed(() => Boolean(me.value?.ready));
  // How many tiles each player was dealt at the start of the round.
  const hand = computed(() => dealSize(s.value, state.value.size));

  /**
   * The name of a seat: the name itself, or the site's "Someone" message when the seat is empty.  Put into words with
   * `text()` (src/useGameText.js), which leaves a plain name as it is.
   *
   * @param {number} seat  a seat number
   * @returns {string | {key: string}} the player's name, or a message
   *
   * Side effects: none.
   */
  const nameOf = (seat) => state.value.seats[seat]?.name ?? msg('common.someone');

  return { state, s, finished, between, me, myTurn, melded, isHost, readyNames, waitingNames, scorePlayers, youReady, hand, nameOf };
}
