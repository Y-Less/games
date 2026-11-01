// The words of the Rummikub table: the Status box's headline and lines, built from the game and your layout so far.
import { computed } from 'vue';

/**
 * The headline, the live message about your layout and the lines for between rounds.
 *
 * @param {object} view  the round view (reactive)
 * @param {object} copy  the working copy (reactive)
 * @returns {object} summary (what your layout is worth, for your turn), headline, lines (strings or { text, tone })
 */
export function useStatusText(view, copy) {
  const summary = computed(() => {
    if (!view.myTurn) return '';
    if (!copy.changed) {
      return view.melded
        ? 'Move tiles from your rack onto the table, or rearrange it. Or draw a tile.'
        : `Make a first meld of ${view.s.meld} or more points from your own tiles${view.s.playOnMeld ? ', then play on with the whole table,' : ''} or draw a tile.`;
    }
    if (copy.status.ok) {
      return view.melded
        ? `Ready: ${copy.status.placed} ${copy.status.placed === 1 ? 'tile' : 'tiles'} played.`
        : `Ready: first meld worth ${copy.status.points} points${copy.status.placed > 0 && view.s.playOnMeld ? ', and the table is open' : ''}.`;
    }
    return copy.status.error;
  });
  const lastLine = computed(() => view.state.log.at(-1)?.text ?? '');
  const headline = computed(() => {
    const state = view.state;
    if (view.finished) return state.winners.length === 1 ? `${view.nameOf(state.winners[0])} wins the game!` : `${state.winners.map(view.nameOf).join(' and ')} share the win.`;
    if (view.between) return `Round ${state.round} is over.`;
    if (state.phase !== 'playing') return '';
    return view.myTurn ? 'Your turn' : `${view.nameOf(state.turn)} is playing`;
  });
  // The live message about your layout (or the last refusal) and, between rounds, who is ready.
  const lines = computed(() => {
    if (view.between) {
      return [
        lastLine.value,
        view.youReady ? `Waiting for ${view.waitingNames.join(', ')}` : 'Close the scores to carry on.',
        { text: `Ready: ${view.readyNames.join(', ') || 'nobody yet'}`, tone: 'muted' },
      ].filter(Boolean);
    }
    if (!view.myTurn) return view.state.phase === 'playing' ? [{ text: `Each player started with ${view.hand} tiles.`, tone: 'muted' }] : [];
    const text = copy.hint || summary.value;
    const tone = copy.hint || (copy.changed && !copy.status.ok) ? 'warn' : copy.changed && copy.status.ok ? 'mine' : '';
    return [{ text, tone }];
  });

  return { summary, headline, lines };
}
