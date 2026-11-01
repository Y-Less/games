// What the view says about whose turn it is and what you may do now. Pure derivations from the server's view: it keeps no
// state of its own and sends nothing.
import { computed } from 'vue';
import { CELLS } from '../rules.js';

/**
 * The facts about the current phase and turn, as computed values.
 * @param {import('vue').ComputedRef<object>} s  the view sent by the server
 * @returns {object} windows, finished, me, myTurn, canPlace, pattern, waitingFor, turnNumber, poolMax, trackSlots, winners,
 *   nameOf(seat), poolDie(id)
 */
export function useTurnState(s) {
  const windows = computed(() => s.value.phase === 'windows');
  const finished = computed(() => s.value.phase === 'finished');
  const me = computed(() => s.value.seats[s.value.you] ?? null);
  const myTurn = computed(() => s.value.phase === 'playing' && s.value.turn?.seat === s.value.you);
  const canPlace = computed(() => myTurn.value && s.value.turn.placements < s.value.turn.allowed);
  const pattern = computed(() => (me.value?.window ? { cells: me.value.window.rows.join('').split('') } : null));
  const waitingFor = computed(() => s.value.seats.filter((seat) => seat && !seat.picked).map((seat) => seat.name));
  const turnNumber = computed(() => (s.value.turn?.number === 2 ? 'second' : 'first'));
  const poolMax = computed(() => 2 * (s.value.size ?? s.value.seats.length) + 1);
  const trackSlots = computed(() => Array.from({ length: s.value.limits.rounds }, (_, i) => s.value.track?.[i] ?? null));
  /** The name of a seat for the Status box ("Someone" if it is empty). */
  const nameOf = (seat) => s.value.seats[seat]?.name ?? 'Someone';
  const winners = computed(() => (s.value.winners ?? []).map(nameOf));
  /** The die in the pool with this id, or null (it may have been placed or changed since the player clicked it). */
  const poolDie = (id) => (s.value.pool ?? []).find((d) => d.id === id) ?? null;
  /** An empty window's worth of spaces (used before the player has a window). */
  const emptyGrid = () => Array(CELLS).fill(null);
  return { windows, finished, me, myTurn, canPlace, pattern, waitingFor, turnNumber, poolMax, trackSlots, winners, nameOf, poolDie, emptyGrid };
}
