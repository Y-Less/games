// How a Splendour game ended: who won, the standings and the notes explaining a tie or an early finish.  The notes are
// messages (`{ key, params }`, see shared/messages.js) that the table puts into words with `text()`.
import { computed } from 'vue';
import { msg } from '../../../shared/messages.js';

/** The note explaining each early finish the server can report, by its `endReason`. */
const END_NOTES = { limit: 'status.endLimit', stalled: 'status.endStalled' };

/**
 * The end-of-game facts (meaningful once the game is finished; all safe to read before then).
 *
 * @param {object} view  the table view (reactive)
 * @returns {object} winners, iWon, standings, isHost, endNote, and tieNote (the last two messages, or null)
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
  // Explains an early finish (round limit or a stalled game), or null.
  const endNote = computed(() => (END_NOTES[view.s.endReason] ? msg(END_NOTES[view.s.endReason]) : null));
  // Explains how a tie at the top was broken or shared, or null when there is no tie.
  const tieNote = computed(() => {
    const top = standings.value.filter((x) => x.prestige === standings.value[0]?.prestige);
    if (top.length < 2) return null;
    return msg(winners.value.length === 1 ? 'status.tieFewerCards' : 'status.tieShared');
  });
  return { winners, iWon, standings, isHost, endNote, tieNote };
}
