// Giving a clue and turning the dial at the Wavelength table: where this person has turned it before locking in, the clue
// they are typing, the needle and markers to draw, and what is sent. In a team game every move of the shared marker goes to
// the server, throttled.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { TEAM_MARKER } from './useGameView.js';

export const SEND_EVERY = 60; // team: at most about 15 marker moves a second

/**
 * Guessing and clueing.
 *
 * Side effects: turn, lockIn and sendClue send 'marker', 'lock', 'guess' and 'clue' requests; the pending team marker
 * move is sent on timers, which are cleared before the component unmounts; picked and clueText are cleared whenever the
 * turn or phase changes.
 *
 * @param {object} view  the game view (reactive, from useGameView)
 * @param {Function} send  sends an action to the server and resolves with its reply
 * @returns {object} picked, clueText, needle, markers, turn(position), lockIn(), sendClue(), flush()
 */
export function useGuessing(view, send) {
  const picked = ref(null); // where this person has turned the dial, before locking it in
  const clueText = ref('');

  // Solo: your own needle. Team: the shared marker, which the psychic does not see until the reveal.
  const needle = computed(() => {
    if (!view.team) return view.canGuess ? picked.value : view.guessing ? view.myGuess : null; // at the reveal your guess is a marker on the rim instead
    return view.canGuess ? picked.value ?? view.state.marker : null;
  });
  const markers = computed(() =>
    view.team ? (view.reveal || view.ended ? view.teamPin() : []) : view.reveal || view.ended
      ? view.state.guesses.map((g) => ({ id: g.id, position: g.position, colour: view.colourOf(g.id), name: view.nameOf(g.id) }))
      : [],
  );

  watch(
    () => `${view.state.turn}-${view.phase}`,
    () => {
      picked.value = null;
      clueText.value = '';
    },
    { immediate: true },
  );

  let pending = null;
  let lastSent = 0;
  let sendTimer = null;
  let settleTimer = null;
  /** Sends the latest team marker position now, if there is one waiting. */
  function flush() {
    clearTimeout(sendTimer);
    sendTimer = null;
    if (pending === null) return;
    lastSent = Date.now();
    const position = pending;
    pending = null;
    send('marker', { position });
  }
  /**
   * Turns the shared marker: your own position shows at once while you are turning it, then the server's takes over.
   *
   * @param {number} position  where on the dial
   */
  function turnTeamMarker(position) {
    picked.value = position;
    pending = position;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => (picked.value = null), 700);
    const wait = SEND_EVERY - (Date.now() - lastSent);
    if (wait <= 0) flush();
    else sendTimer ??= setTimeout(flush, wait);
  }
  /**
   * The dial was turned: move your needle (solo) or the team's marker.
   *
   * @param {number} position  where on the dial
   */
  const turn = (position) => (view.team ? turnTeamMarker(position) : (picked.value = position));
  onBeforeUnmount(() => {
    clearTimeout(sendTimer);
    clearTimeout(settleTimer);
  });

  /** Locks in the guess (solo) or the team's marker (team). */
  async function lockIn() {
    if (view.team) {
      flush();
      await send('lock');
      return;
    }
    if (picked.value === null) return;
    const reply = await send('guess', { position: picked.value });
    if (reply.ok) picked.value = null;
  }
  /** Sends the clue that has been typed. */
  const sendClue = () => send('clue', { text: clueText.value });

  return { picked, clueText, needle, markers, turn, lockIn, sendClue, flush, TEAM_MARKER };
}
