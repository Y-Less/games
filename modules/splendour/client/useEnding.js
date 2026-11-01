// How a Splendour game ended: who won, the standings and the notes explaining a tie or an early finish.
import { computed } from 'vue';

/**
 * The end-of-game facts (meaningful once the game is finished; all safe to read before then).
 *
 * @param {object} view  the table view (reactive)
 * @returns {object} winners, iWon, standings, isHost, endNote, tieNote
 */
export function useEnding(view) {
  const winners = computed(() => (view.s.winners ?? []).map((i) => ({ seat: i, name: view.nameOf(i), ...view.s.standings[i] })));
  const iWon = computed(() => (view.s.winners ?? []).includes(view.s.you));
  const standings = computed(() => (view.s.standings ?? []).map((x) => ({ ...x, name: view.nameOf(x.seat) })).sort((a, b) => b.prestige - a.prestige || a.cards - b.cards));
  const isHost = computed(() => view.s.hostSeat === view.s.you);
  const endNote = computed(() => {
    if (view.s.endReason === 'limit') return 'The game reached its round limit.';
    if (view.s.endReason === 'stalled') return 'Nobody could do anything any more.';
    return '';
  });
  const tieNote = computed(() => {
    const top = standings.value.filter((x) => x.prestige === standings.value[0]?.prestige);
    if (top.length < 2) return '';
    return winners.value.length === 1 ? 'Level on prestige: the player with fewer cards wins.' : 'Level on prestige and on cards bought: the win is shared.';
  });
  return { winners, iWon, standings, isHost, endNote, tieNote };
}
