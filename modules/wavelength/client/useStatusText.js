// The words of the Wavelength table: the Status box's headline and lines for the phase, your role and your guess so far.
import { computed } from 'vue';
import { maxScore } from '../scoring.js';

/**
 * The headline, whether it is your move, and the lines under it.
 *
 * Side effects: none (computed values only).
 *
 * @param {object} view  the game view (reactive, from useGameView)
 * @param {object} guess  the guessing state (reactive, from useGuessing): its `picked` is read
 * @returns {object} headline, mineNow (it is your move) and lines (strings or { text, tone })
 */
export function useStatusText(view, guess) {
  // The Status box's title for this phase, role and mode.
  const headline = computed(() => {
    const { state } = view;
    if (view.phase === 'abandoned') return 'The game was abandoned.';
    if (view.phase === 'finished' && view.team) return `Your team scored ${view.standings[0].score} of ${maxScore(state.turnsTotal)} points.`;
    if (view.phase === 'finished') return `${view.winners.join(' and ')} ${view.winners.length > 1 ? 'win' : 'wins'} with ${view.standings[0].score} points.`;
    if (view.reveal && view.team) return `Your team scores ${state.result?.psychicPoints ?? 0} for this turn.`;
    if (view.reveal) return `${state.result?.psychicName ?? view.psychicName} scores ${state.result?.psychicPoints ?? 0} for the clue.`;
    if (view.clueTime) {
      return view.isPsychic
        ? 'You are the psychic: the target is shown on your dial. Type a clue that points to it, without numbers or the words on the dial.'
        : `Waiting for ${view.psychicName}'s clue.`;
    }
    if (view.isPsychic && view.team) return 'Your clue is in. Your team is moving the marker together. You cannot see it until the reveal.';
    if (view.team) return 'Move the marker together until you all agree, then anyone can lock it in.';
    if (view.isPsychic) return `Your clue is in. Waiting for everyone to guess (${view.guessedCount} of ${view.guessers.length}).`;
    if (view.mine?.guessed) return `Guess locked in. Waiting for the others (${view.guessedCount} of ${view.guessers.length}).`;
    return 'Your turn: read the clue and turn the dial to where you think the target is.';
  });
  // True when the table should be highlighted as yours: you are the psychic writing a clue, or you may guess.
  const mineNow = computed(() => (view.clueTime && view.isPsychic) || view.canGuess);
  // The smaller lines under the headline: advice for the phase, as strings or { text, tone } objects.
  const lines = computed(() => {
    if (view.phase === 'abandoned') return [{ text: 'Too many players left, so this game does not count towards the statistics.', tone: 'muted' }, 'Use Leave game (top right) to go back to the menu.'];
    if (view.phase === 'finished') return [{ text: 'Use Leave game (top right) to go back to the menu, or "All rounds" in the score bar to see every turn again.', tone: 'muted' }];
    if (view.reveal) {
      return [
        'Every guess is on the dial.',
        view.mine?.ready
          ? { text: `Waiting for ${view.waitingFor.join(', ')} to be ready${view.lastTurn ? ' for the final scores' : ' for the next turn'}.`, tone: 'muted' }
          : { text: 'Close the scores when you are ready to carry on.', tone: 'mine' },
      ];
    }
    if (view.guessing && view.team) return [{ text: view.isPsychic ? 'Wait for your team to lock in.' : 'Drag on the dial, or use the slider. Everyone sees the marker move.', tone: 'muted' }];
    if (view.guessing && view.isPsychic) return [`${view.guessedCount} of ${view.guessers.length} have guessed.`];
    if (view.canGuess) return [{ text: guess.picked === null ? 'Drag on the dial, or use the slider under it.' : 'Lock it in when you are ready.', tone: 'muted' }];
    return [];
  });
  return { headline, mineNow, lines };
}
