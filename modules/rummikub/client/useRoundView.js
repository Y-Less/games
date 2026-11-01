// What the Rummikub table knows about the game from the server's view, for the player looking at it: the settings, the phase,
// whose turn it is, who is ready between rounds. Nothing here changes anything.
import { computed } from 'vue';
import { dealSize } from '../rules.js';

/**
 * The facts about the round that the whole table shares.
 *
 * @param {() => object} getState  returns the current server view (read inside computed values, so it stays reactive)
 * @returns {object} computed values: state, s (the settings), finished, between, me, myTurn, melded, isHost, readyNames,
 *   waitingNames, scorePlayers, youReady, hand; and the function nameOf(seat)
 */
export function useRoundView(getState) {
  const state = computed(getState);
  const s = computed(() => state.value.settings);
  const finished = computed(() => state.value.phase === 'finished');
  const between = computed(() => state.value.phase === 'between');
  const me = computed(() => state.value.seats[state.value.you] ?? null);
  const myTurn = computed(() => state.value.phase === 'playing' && state.value.turn === state.value.you && state.value.you !== -1);
  const melded = computed(() => Boolean(me.value?.melded));
  const isHost = computed(() => state.value.hostSeat === state.value.you);
  const readyNames = computed(() => state.value.seats.filter((x) => x && !x.bot && x.ready).map((x) => x.name));
  const waitingNames = computed(() => (between.value ? state.value.seats.filter((x) => x && !x.bot && !x.ready).map((x) => x.name) : []));
  const scorePlayers = computed(() => state.value.scoreboard.players.map((p) => ({ ...p, ready: between.value && Boolean(state.value.seats[p.id]?.bot || state.value.seats[p.id]?.ready) })));
  const youReady = computed(() => Boolean(me.value?.ready));
  const hand = computed(() => dealSize(s.value, state.value.size));

  /**
   * The name of a seat, or "Someone" when it is empty.
   *
   * @param {number} seat  a seat number
   * @returns {string} the player's name
   */
  const nameOf = (seat) => state.value.seats[seat]?.name ?? 'Someone';

  return { state, s, finished, between, me, myTurn, melded, isHost, readyNames, waitingNames, scorePlayers, youReady, hand, nameOf };
}
