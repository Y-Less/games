// What the Wavelength table knows about the game from the server's view, for the player looking at it: the phase, the
// roles, who has guessed, the standings and the markers to draw. Nothing here changes anything.
import { computed } from 'vue';

/** The colour of the shared team marker. */
export const TEAM_MARKER = '#ffd400';

/**
 * The facts about the game that the whole table shares.
 *
 * @param {() => object} getState  returns the current server view (read inside computed values, so it stays reactive)
 * @returns {object} computed values: state, team, phase, isPsychic, clueTime, guessing, playing, ended, reveal, psychicName,
 *   guessers, guessedCount, mine, others, lastTurn, waitingFor, canGuess, standings, winners, myGuess, popupMarkers; and
 *   the functions nameOf(id), colourOf(id) and teamPin()
 */
export function useGameView(getState) {
  const state = computed(getState);
  const team = computed(() => state.value.mode === 'team'); // the guessers share one marker, move it together and lock it in
  const phase = computed(() => state.value.phase);
  const isPsychic = computed(() => state.value.psychic === state.value.you);
  const clueTime = computed(() => phase.value === 'clue');
  const guessing = computed(() => phase.value === 'guessing');
  const playing = computed(() => clueTime.value || guessing.value);
  const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
  const reveal = computed(() => phase.value === 'reveal');
  const psychicName = computed(() => state.value.players.find((p) => p.id === state.value.psychic)?.name ?? 'The psychic');
  const guessers = computed(() => state.value.players.filter((p) => p.id !== state.value.psychic));
  const guessedCount = computed(() => guessers.value.filter((p) => p.guessed).length);
  const mine = computed(() => state.value.players.find((p) => p.id === state.value.you));
  const others = computed(() => state.value.players.filter((p) => p.id !== state.value.you));
  const lastTurn = computed(() => state.value.turn >= state.value.turnsTotal);
  const waitingFor = computed(() => (reveal.value ? state.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
  const canGuess = computed(() => guessing.value && !isPsychic.value && (team.value || !mine.value?.guessed));
  const standings = computed(() => [...state.value.players].sort((a, b) => b.score - a.score));
  const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
  const myGuess = computed(() => state.value.guesses.find((g) => g.id === state.value.you)?.position ?? null);

  /**
   * A player's name, or "Someone" when they are not in the game.
   *
   * @param {number} id  a player id
   * @returns {string} the name
   */
  const nameOf = (id) => state.value.players.find((p) => p.id === id)?.name ?? 'Someone';
  /**
   * A player's marker colour, or white when they are not in the game.
   *
   * @param {number} id  a player id
   * @returns {string} a CSS colour
   */
  const colourOf = (id) => state.value.players.find((p) => p.id === id)?.colour ?? '#fff';
  /**
   * The team's shared marker as a list of one pin (empty before it has been placed).
   *
   * @returns {object[]} pins for the dial
   */
  const teamPin = () => (state.value.marker === null ? [] : [{ id: 'team', position: state.value.marker, colour: TEAM_MARKER, name: 'Your team' }]);
  const popupMarkers = computed(() => (team.value ? teamPin() : (state.value.result?.entries ?? [])).map((e) => ({ id: e.id, position: e.position, name: e.name, colour: colourOf(e.id) })));

  return { state, team, phase, isPsychic, clueTime, guessing, playing, ended, reveal, psychicName, guessers, guessedCount, mine, others, lastTurn, waitingFor, canGuess, standings, winners, myGuess, popupMarkers, nameOf, colourOf, teamPin };
}
