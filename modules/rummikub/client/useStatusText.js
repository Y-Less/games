// The words of the Rummikub table: the Status box's headline and lines, built from the game and your layout so far.
// Nothing here is written in English: the component passes in its text helpers (src/useGameText.js) and every sentence
// is a key in the game's locale file, while anything the server sent (a log line, the rules' refusal) is a message put
// into words with `text()`.
import { computed } from 'vue';

/**
 * The headline, the live message about your layout, and the lines for between rounds.
 *
 * Side effects: none (computed values only).
 *
 * @param {object} view  the round view (reactive)
 * @param {object} copy  the working copy (reactive)
 * @param {{ t: Function, text: Function, list: Function }} words  the component's text helpers (useGameText())
 * @returns {object} summary (what your layout is worth, for your turn), headline, lines (strings or { text, tone })
 */
export function useStatusText(view, copy, { t, text, list }) {
  // A seat's name in words (a plain name comes back as it is; an empty seat is the site's "Someone").
  const named = (seat) => text(view.nameOf(seat));
  // What your layout is worth, in words: instructions before you touch anything, then "Ready" or the rules' refusal.
  const summary = computed(() => {
    if (!view.myTurn) return '';
    if (!copy.changed) {
      if (view.melded) return t('status.yourMove');
      return t(view.s.playOnMeld ? 'status.makeMeldOpen' : 'status.makeMeld', { meld: view.s.meld });
    }
    if (copy.status.ok) {
      if (view.melded) return t('status.readyPlayed', { count: copy.status.placed }, copy.status.placed);
      const open = copy.status.placed > 0 && view.s.playOnMeld;
      return t(open ? 'status.readyMeldOpen' : 'status.readyMeld', { points: copy.status.points });
    }
    return text(copy.status.error);
  });
  // The newest entry of the game log (null if there is none), shown between rounds as the round's outcome.
  const lastLine = computed(() => view.state.log.at(-1) ?? null);
  // The Status box's title: the winner(s), the end of a round, or whose turn it is.
  const headline = computed(() => {
    const state = view.state;
    if (view.finished) {
      return state.winners.length === 1 ? t('status.wins', { name: named(state.winners[0]) }) : t('status.shareWin', { names: list(state.winners.map(named)) });
    }
    if (view.between) return t('status.roundOver', { n: state.round });
    if (state.phase !== 'playing') return '';
    return view.myTurn ? t('status.yourTurn') : t('status.playing', { name: named(state.turn) });
  });
  // The live message about your layout (or the last refusal) and, between rounds, who is ready.
  const lines = computed(() => {
    if (view.between) {
      return [
        lastLine.value ? text(lastLine.value) : '',
        view.youReady ? t('status.waitingFor', { names: list(view.waitingNames) }) : t('status.closeScores'),
        { text: view.readyNames.length ? t('status.ready', { names: list(view.readyNames) }) : t('status.readyNobody'), tone: 'muted' },
      ].filter(Boolean);
    }
    if (!view.myTurn) return view.state.phase === 'playing' ? [{ text: t('status.startedWith', { count: view.hand }, view.hand), tone: 'muted' }] : [];
    const line = copy.hint ? text(copy.hint) : summary.value;
    const tone = copy.hint || (copy.changed && !copy.status.ok) ? 'warn' : copy.changed && copy.status.ok ? 'mine' : '';
    return [{ text: line, tone }];
  });

  return { summary, headline, lines };
}
