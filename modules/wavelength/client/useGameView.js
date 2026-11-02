// What the Wavelength table knows about the game from the server's view, for the player looking at it: the phase, the
// roles, who has guessed, the standings and the markers to draw. Nothing here changes anything.
// The few words it works out (a missing player's name, the psychic, the team's marker) come from the game's locale file
// through useGameText (src/useGameText.js), so they read in the player's language.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';

/** The colour of the shared team marker (yellow, distinct from every player's own marker colour). */
export const TEAM_MARKER = '#ffd400';

/**
 * The facts about the game that the whole table shares.
 * Each is a computed value, so components re-render only when the part of the view they read changes.
 *
 * Side effects: none (computed values only; nothing is mutated, emitted or listened to).
 *
 * @param {() => object} getState  returns the current server view (read inside computed values, so it stays reactive)
 * @returns {object} computed values: state, team, phase, isPsychic, clueTime, guessing, playing, ended, reveal, psychicName,
 *   guessers, guessedCount, mine, others, lastTurn, waitingFor, canGuess, standings, winners, myGuess, popupMarkers; and
 *   the functions nameOf(id), colourOf(id) and teamPin()
 */
export function useGameView(getState) {
  const { t } = useGameText();
  // The server view itself.
  const state = computed(getState);
  const team = computed(() => state.value.mode === 'team'); // the guessers share one marker, move it together and lock it in
  // The current phase: lobby, clue, guessing, reveal, finished or abandoned.
  const phase = computed(() => state.value.phase);
  // True if you are this turn's psychic (you can see the target but not guess).
  const isPsychic = computed(() => state.value.psychic === state.value.you);
  // True while the psychic is writing the clue.
  const clueTime = computed(() => phase.value === 'clue');
  // True while the guessers are placing their guesses.
  const guessing = computed(() => phase.value === 'guessing');
  // True during either half of a live turn.
  const playing = computed(() => clueTime.value || guessing.value);
  // True once the game is over (finished normally, or abandoned).
  const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
  // True while the target and everyone's guesses are shown.
  const reveal = computed(() => phase.value === 'reveal');
  // The psychic's name, or "The psychic" if they cannot be found.
  const psychicName = computed(() => state.value.players.find((p) => p.id === state.value.psychic)?.name ?? t('table.thePsychic'));
  // Everyone except the psychic.
  const guessers = computed(() => state.value.players.filter((p) => p.id !== state.value.psychic));
  // How many guessers have locked in.
  const guessedCount = computed(() => guessers.value.filter((p) => p.guessed).length);
  // Your own player record (undefined for a spectator).
  const mine = computed(() => state.value.players.find((p) => p.id === state.value.you));
  // Every player except you.
  const others = computed(() => state.value.players.filter((p) => p.id !== state.value.you));
  // True on the final turn of the game.
  const lastTurn = computed(() => state.value.turn >= state.value.turnsTotal);
  // At the reveal, the names of players who have not yet closed the scores; otherwise empty.
  const waitingFor = computed(() => (reveal.value ? state.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
  // True when you may move the dial now: guessing phase, not the psychic, and (solo) not already locked in.
  const canGuess = computed(() => guessing.value && !isPsychic.value && (team.value || !mine.value?.guessed));
  // Players ordered by score, highest first (a sorted copy; the view's own order is untouched).
  const standings = computed(() => [...state.value.players].sort((a, b) => b.score - a.score));
  // The names of the winning players.
  const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
  // Your locked-in guess position, or null if you have not guessed.
  const myGuess = computed(() => state.value.guesses.find((g) => g.id === state.value.you)?.position ?? null);

  /**
   * A player's name, or "Someone" when they are not in the game.
   *
   * @param {number} id  a player id
   * @returns {string} the name
   *
   * Side effects: none.
   */
  const nameOf = (id) => state.value.players.find((p) => p.id === id)?.name ?? t('common.someone');
  /**
   * A player's marker colour, or white when they are not in the game.
   *
   * @param {number} id  a player id
   * @returns {string} a CSS colour
   *
   * Side effects: none.
   */
  const colourOf = (id) => state.value.players.find((p) => p.id === id)?.colour ?? '#fff';
  /**
   * The team's shared marker as a list of one pin (empty before it has been placed).
   *
   * @returns {object[]} pins for the dial
   *
   * Side effects: none.
   */
  const teamPin = () => (state.value.marker === null ? [] : [{ id: 'team', position: state.value.marker, colour: TEAM_MARKER, name: t('table.yourTeam') }]);
  // The markers shown in the scoreboard's turn pop-up: the team's one marker (in the team colour it already carries), or
  // each player's guess in their own colour.
  const popupMarkers = computed(() => (team.value ? teamPin() : (state.value.result?.entries ?? [])).map((e) => ({ id: e.id, position: e.position, name: e.name, colour: e.colour ?? colourOf(e.id) })));

  return { state, team, phase, isPsychic, clueTime, guessing, playing, ended, reveal, psychicName, guessers, guessedCount, mine, others, lastTurn, waitingFor, canGuess, standings, winners, myGuess, popupMarkers, nameOf, colourOf, teamPin };
}
