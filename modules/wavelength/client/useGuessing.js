// Giving a clue and turning the dial at the Wavelength table: where this person has turned it before locking in, the clue
// they are typing, the needle and markers to draw, and what is sent. In a team game every move of the shared marker goes to
// the server, throttled.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { TEAM_MARKER } from './useGameView.js';

// Minimum gap in milliseconds between team marker updates sent to the server.
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
  const clueText = ref(''); // the clue being typed (psychic only)

  // The needle to draw. Solo: your own needle. Team: the shared marker, which the psychic does not see until the reveal.
  const needle = computed(() => {
    if (!view.team) return view.canGuess ? picked.value : view.guessing ? view.myGuess : null; // at the reveal your guess is a marker on the rim instead
    return view.canGuess ? picked.value ?? view.state.marker : null;
  });
  // The markers on the dial's rim: guesses (or the team's marker) once the turn is revealed or the game is over, else none.
  const markers = computed(() =>
    view.team ? (view.reveal || view.ended ? view.teamPin() : []) : view.reveal || view.ended
      ? view.state.guesses.map((g) => ({ id: g.id, position: g.position, colour: view.colourOf(g.id), name: view.nameOf(g.id) }))
      : [],
  );

  // A new turn or phase starts afresh: forget the old dial position and clue.
  watch(
    () => `${view.state.turn}-${view.phase}`,
    () => {
      picked.value = null;
      clueText.value = '';
    },
    { immediate: true },
  );

  let pending = null; // the newest team marker position not yet sent
  let lastSent = 0; // when the last marker update went out
  let sendTimer = null; // the timer that will send `pending` once the throttle gap has passed
  let settleTimer = null; // the timer that hands the marker back to the server's position after you stop turning
  /**
   * Sends the latest team marker position now, if there is one waiting.
   *
   * @returns {void} nothing
   *
   * Side effects: cancels the pending send timer, updates the throttle bookkeeping and sends a 'marker' request.
   */
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
   * @returns {void} nothing
   *
   * Side effects: sets `picked`, restarts the 700ms settle timer, and either sends at once or schedules a throttled send.
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
   * @returns {void} nothing
   *
   * Side effects: as for turnTeamMarker in a team game; in a solo game only sets `picked`.
   */
  const turn = (position) => (view.team ? turnTeamMarker(position) : (picked.value = position));
  // Stop any scheduled sends and the settle timer so nothing fires after the component has gone.
  onBeforeUnmount(() => {
    clearTimeout(sendTimer);
    clearTimeout(settleTimer);
  });

  /**
   * Locks in the guess (solo) or the team's marker (team).
   *
   * @returns {Promise<void>} resolves when the server has replied (a solo lock-in with nothing picked does nothing)
   *
   * Side effects: sends any waiting marker move, then a 'lock' (team) or 'guess' (solo) request; clears `picked` after an accepted guess.
   */
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
  /**
   * Sends the clue that has been typed.
   *
   * @returns {Promise<object>} the server's reply
   *
   * Side effects: sends a 'clue' request.
   */
  const sendClue = () => send('clue', { text: clueText.value });

  return { picked, clueText, needle, markers, turn, lockIn, sendClue, flush, TEAM_MARKER };
}
