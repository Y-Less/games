// How a Splendour game ended: who won, the standings and the notes explaining a tie or an early finish.
import { computed } from 'vue';

/**
 * The end-of-game facts (meaningful once the game is finished; all safe to read before then).
 *
 * @param {object} view  the table view (reactive)
 * @returns {object} winners, iWon, standings, isHost, endNote, tieNote
 *
 * Side effects: none (creates computed values only).
 */
export function useEnding(view) {
  // The winning players with their standings details (seat, name, prestige, cards).
  const winners = computed(() => (view.s.winners ?? []).map((i) => ({ seat: i, name: view.nameOf(i), ...view.s.standings[i] })));
  // True when you are among the winners.
  const iWon = computed(() => (view.s.winners ?? []).includes(view.s.you));
  // Everyone ranked: most prestige first, ties broken by fewer cards bought.
  const standings = computed(() => (view.s.standings ?? []).map((x) => ({ ...x, name: view.nameOf(x.seat) })).sort((a, b) => b.prestige - a.prestige || a.cards - b.cards));
  // True when you are the host (only they may start a new game).
  const isHost = computed(() => view.s.hostSeat === view.s.you);
  // Explains an early finish (round limit or a stalled game), or ''.
  const endNote = computed(() => {
    if (view.s.endReason === 'limit') return 'The game reached its round limit.';
    if (view.s.endReason === 'stalled') return 'Nobody could do anything any more.';
    return '';
  });
  // Explains how a tie at the top was broken or shared, or '' when there is no tie.
  const tieNote = computed(() => {
    const top = standings.value.filter((x) => x.prestige === standings.value[0]?.prestige);
    if (top.length < 2) return '';
    return winners.value.length === 1 ? 'Level on prestige: the player with fewer cards wins.' : 'Level on prestige and on cards bought: the win is shared.';
  });
  return { winners, iWon, standings, isHost, endNote, tieNote };
}
