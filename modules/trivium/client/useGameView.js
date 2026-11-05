// What the Trivium table knows about the game from the server's view, for the player looking at it: which part of a
// round is happening, what you may do about it, and who is where.  Nothing here changes anything.
import { computed } from 'vue';

/**
 * The facts about the game that the whole table shares.  Each is a computed value, so a component re-renders only
 * when the part of the view it reads changes.
 *
 * @param {() => object} getState  returns the current server view (read inside computed values, so it stays reactive)
 * @returns {object} computed values and the lookups nameOf(id) and colourOf(id)
 * Side effects: none (computed values only; nothing is mutated, emitted or listened to).
 */
export function useGameView(getState) {
  // The server view itself.
  const state = computed(getState);
  // The current phase: lobby, spin, question, reveal, finished or abandoned.
  const phase = computed(() => state.value.phase);
  // True while the wheel is turning for a category.
  const spinning = computed(() => phase.value === 'spin');
  // True while a question is up and may be answered.
  const asking = computed(() => phase.value === 'question');
  // True while the answers are being walked through and the right one shown.
  const revealing = computed(() => phase.value === 'reveal');
  // True once the game is over (finished normally, or given up on).
  const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
  // True when the game ran out of questions rather than reaching its last one.
  const abandoned = computed(() => phase.value === 'abandoned');
  // Your own player record (undefined for a spectator).
  const mine = computed(() => state.value.players.find((p) => p.id === state.value.you));
  // Every player except you.
  const others = computed(() => state.value.players.filter((p) => p.id !== state.value.you));
  // Your answer to the question that is up, or null if you have not given one.
  const myAnswer = computed(() => state.value.mine);
  // True when you may press a button right now.
  const canAnswer = computed(() => asking.value && Boolean(mine.value) && !myAnswer.value);
  // The answers given to the question just closed, quickest first; empty before the reveal.
  const entries = computed(() => state.value.result?.entries ?? []);
  // The index of the right answer, or null before it is shown.
  const correct = computed(() => state.value.correct);
  // How many players have answered the question that is up.
  const answeredCount = computed(() => state.value.players.filter((p) => p.answered).length);
  // The category this round is about, or an empty string in the lobby.
  const category = computed(() => state.value.spin?.category ?? '');
  // Players ordered by score, highest first (a sorted copy; the view's own order is untouched).
  const standings = computed(() => [...state.value.players].sort((a, b) => b.score - a.score));
  // The names of the winning players.
  const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
  // How many questions the whole game has, for the facts line.
  const total = computed(() => state.value.rounds * state.value.perRound);

  /**
   * A player's name, or an empty string when they are not in the game.
   *
   * @param {number|string} id  a player id
   * @returns {string} the name
   * Side effects: none.
   */
  const nameOf = (id) => state.value.players.find((p) => p.id === id)?.name ?? '';
  /**
   * A player's marker colour, or white when they are not in the game.
   *
   * @param {number|string} id  a player id
   * @returns {string} a CSS colour
   * Side effects: none.
   */
  const colourOf = (id) => state.value.players.find((p) => p.id === id)?.colour ?? '#ffffff';

  return { state, phase, spinning, asking, revealing, ended, abandoned, mine, others, myAnswer, canAnswer, entries, correct, answeredCount, category, standings, winners, total, nameOf, colourOf };
}
