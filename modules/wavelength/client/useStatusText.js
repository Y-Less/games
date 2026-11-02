// The words of the Wavelength table: the Status box's headline and lines for the phase, your role and your guess so far.
// Every sentence comes from the game's locale file through useGameText (src/useGameText.js), so the box reads in the
// player's language.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
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
  const { t, list } = useGameText();
  // The Status box's title for this phase, role, and mode.
  const headline = computed(() => {
    const { state } = view;
    if (view.phase === 'abandoned') return t('status.abandoned');
    if (view.phase === 'finished' && view.team) return t('status.teamFinal', { score: view.standings[0].score, max: maxScore(state.turnsTotal) });
    if (view.phase === 'finished') return t('status.wins', { names: list(view.winners), score: view.standings[0].score, count: view.winners.length }, view.winners.length);
    if (view.reveal && view.team) return t('status.teamTurn', { points: state.result?.psychicPoints ?? 0 });
    if (view.reveal) return t('status.psychicScores', { name: state.result?.psychicName ?? view.psychicName, points: state.result?.psychicPoints ?? 0 });
    if (view.clueTime) {
      return view.isPsychic ? t('status.youArePsychic') : t('status.waitingClue', { name: view.psychicName });
    }
    if (view.isPsychic && view.team) return t('status.psychicTeam');
    if (view.team) return t('status.teamMove');
    if (view.isPsychic) return t('status.psychicWaiting', { n: view.guessedCount, total: view.guessers.length });
    if (view.mine?.guessed) return t('status.guessLocked', { n: view.guessedCount, total: view.guessers.length });
    return t('status.guessNow');
  });
  // True when the table should be highlighted as yours: you are the psychic writing a clue, or you may guess.
  const mineNow = computed(() => (view.clueTime && view.isPsychic) || view.canGuess);
  // The smaller lines under the headline: advice for the phase, as strings or { text, tone } objects.
  const lines = computed(() => {
    if (view.phase === 'abandoned') return [{ text: t('status.abandonedNote'), tone: 'muted' }, t('status.leaveHint')];
    if (view.phase === 'finished') return [{ text: t('status.finishedHint'), tone: 'muted' }];
    if (view.reveal) {
      return [
        t('status.everyGuess'),
        view.mine?.ready
          ? { text: t(view.lastTurn ? 'status.waitingFinal' : 'status.waitingNext', { names: list(view.waitingFor) }), tone: 'muted' }
          : { text: t('status.closeScores'), tone: 'mine' },
      ];
    }
    if (view.guessing && view.team) return [{ text: view.isPsychic ? t('status.waitTeamLock') : t('status.teamDrag'), tone: 'muted' }];
    if (view.guessing && view.isPsychic) return [t('status.guessedCount', { n: view.guessedCount, total: view.guessers.length })];
    if (view.canGuess) return [{ text: guess.picked === null ? t('status.dragHint') : t('status.lockHint'), tone: 'muted' }];
    return [];
  });
  return { headline, mineNow, lines };
}
