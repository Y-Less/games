<script setup>
// The Just One table, for every phase of a game: the score bar, the secret word (hidden from the guesser), the clues and the
// controls for the moment, slim bars for the other players, and the two standard boxes along the bottom. The writers see the
// word and send one-word clues; the guesser sees the clues that were not cancelled, guesses once, and picks the best hint.
//
// Props: state (the server's view), send (function: (event, payload) -> Promise<{ ok, error }>), log (Recent moves, an array
// of messages kept by JustOne.vue, see moveLog.js).
// Emits: none. Slots: none (it fills GameFrame's scorebar, main, others, log and status slots).
// Side effects: sends 'clue', 'guess', 'pass', 'best', 'ready', 'removeBot' and 'kick' requests; one watcher on the view
// empties the clue and guess boxes when the turn or phase changes.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { keyFor } from '../../../src/messageText.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] }, // Recent moves: messages, kept by the page (see moveLog.js)
});
const { t, text, list, game } = useGameText();

const clueText = ref(''); // what is typed in the clue box
const guessText = ref(''); // what is typed in the guess box

const s = computed(() => props.state); // the view as a computed, so everything below recalculates when it changes
// The phase of the game; the booleans below name the ones the template asks about.
const phase = computed(() => s.value.phase);
// You are this turn's guesser (who must not see the word).
const isGuesser = computed(() => s.value.guesser === s.value.you);
const clueTime = computed(() => phase.value === 'clues');
const guessing = computed(() => phase.value === 'guessing');
const choosing = computed(() => phase.value === 'choosing');
const reveal = computed(() => phase.value === 'reveal');
const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
// Any of the three phases in which a turn is being played (not the reveal or the end).
const playing = computed(() => clueTime.value || guessing.value || choosing.value);
// Your own player entry.
const mine = computed(() => s.value.players.find((p) => p.id === s.value.you));
// Everyone but you, drawn as the slim bars.
const others = computed(() => s.value.players.filter((p) => p.id !== s.value.you));
// A player's name by id, or the site's "Someone" if they are not in the game.
const nameOf = (id) => s.value.players.find((p) => p.id === id)?.name ?? t('common.someone');
// The guesser's name.
const guesserName = computed(() => nameOf(s.value.guesser));
// The players writing clues this turn (everyone but the guesser).
const writerList = computed(() => s.value.players.filter((p) => p.id !== s.value.guesser));
// How many writers have sent a clue.
const writtenCount = computed(() => writerList.value.filter((p) => p.written).length);
// This is the final turn of the game.
const lastTurn = computed(() => s.value.turn >= s.value.turnsTotal);
// Names of the players who have not yet closed the turn's scores (reveal phase only).
const waitingFor = computed(() => (reveal.value ? s.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
// A copy of the players ordered by score, highest first.
const standings = computed(() => [...s.value.players].sort((a, b) => b.score - a.score));
// The winners' names (empty until the game is over).
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
// The clue you have written this turn, or null.
const myClue = computed(() => s.value.clues.find((c) => c.own) ?? null);
// You may write a clue now: clue phase, you are a writer, and you have not written yet.
const canWrite = computed(() => clueTime.value && !isGuesser.value && !myClue.value);
// You may guess now: you are the guesser and it is the guessing phase.
const canGuess = computed(() => guessing.value && isGuesser.value);
// Your own clue was cancelled (shown to you as a warning once the clues are in).
const ownCancelled = computed(() => (guessing.value || choosing.value) && !isGuesser.value && s.value.clues.some((c) => c.id === s.value.you && c.cancelled));
// The full key of the reveal's "The word was {word}" line, for <i18n-t>, which wraps the word in its own element.
const wordWasKey = keyFor('reveal.wordWas', game);

// Typed text belongs to one turn and phase: it is emptied when either changes (and once at the start).
watch(
  () => `${s.value.turn}-${phase.value}`,
  () => {
    clueText.value = '';
    guessText.value = '';
  },
  { immediate: true },
);

// Sends the typed clue; returns the request's promise (the server rejects empty or invalid clues).
const sendClue = () => props.send('clue', { text: clueText.value });
// Sends the typed guess; returns the request's promise.
const sendGuess = () => props.send('guess', { text: guessText.value });

// ---- the words in the Status box ----
// The Status headline for the phase and your role, as one sentence ('' when there is nothing to say).
const headline = computed(() => {
  if (phase.value === 'abandoned') return t('status.abandoned');
  if (phase.value === 'finished') return t('status.wins', { names: list(winners.value), score: standings.value[0].score, count: winners.value.length }, winners.value.length);
  if (reveal.value) {
    const r = s.value.result;
    if (!r) return '';
    if (!r.correct) return r.guess?.passed ? t('status.revealPassed', { name: r.guesserName, word: r.word }) : t('status.revealGuessed', { name: r.guesserName, guess: r.guess?.text, word: r.word });
    return r.bestName ? t('status.revealBest', { name: r.guesserName, best: r.bestName }) : t('status.revealNoHint', { name: r.guesserName });
  }
  if (clueTime.value) {
    const progress = { written: writtenCount.value, total: writerList.value.length };
    if (isGuesser.value) return t('status.guesserWriting', progress);
    if (canWrite.value) return t('status.write', { word: s.value.word });
    return t('status.clueSent', progress);
  }
  if (guessing.value) return isGuesser.value ? t('status.yourGuess') : t('status.guessing', { name: guesserName.value });
  if (choosing.value) return isGuesser.value ? t('status.pickBest') : t('status.choosing', { name: guesserName.value });
  return '';
});
// It is your move (highlights the Status box): you can write a clue, or you are the guesser in the guessing or choosing phase.
const mineNow = computed(() => canWrite.value || (isGuesser.value && (guessing.value || choosing.value)));
// The further Status lines. Most are { text, tone } where tone only picks the colour; the abandoned case also holds a plain string.
const lines = computed(() => {
  if (phase.value === 'abandoned') return [{ text: t('status.abandonedNote'), tone: 'muted' }, t('status.leaveToMenu')];
  if (phase.value === 'finished') return [{ text: t('status.finishedNote'), tone: 'muted' }];
  if (reveal.value) {
    return [
      mine.value?.ready
        ? { text: t(lastTurn.value ? 'status.waitingReadyFinal' : 'status.waitingReadyNext', { names: list(waitingFor.value) }), tone: 'muted' }
        : { text: t('status.closeScores'), tone: 'mine' },
    ];
  }
  if (ownCancelled.value) return [{ text: t('status.ownCancelled'), tone: 'warn' }];
  if (canGuess.value) return [{ text: t('status.scoring', { guesser: s.value.points.guesser, bestHint: s.value.points.bestHint }), tone: 'muted' }];
  if (choosing.value && isGuesser.value) return [{ text: t('status.clickBest'), tone: 'muted' }];
  return [];
});

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button). The scoreboard's ids are the accounts' ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostId,
  isHost: () => s.value.you === s.value.hostId,
  remove: (id, player) => (player?.bot ? props.send('removeBot', { seat: id }) : props.send('kick', { userId: id })),
});
// The player whose chip was clicked in the score bar, or null when no pop-up is open.
const opened = computed(() => s.value.players.find((p) => p.id === openId.value) ?? null);
/**
 * What a player is doing now, for their pop-up.
 * @param {{ id: string, written: boolean }} p  a player from the view
 * @returns {string} the phrase, or '' when there is nothing to say (after the game, or in other phases)
 * Side effects: none.
 */
const stageOf = (p) => {
  if (ended.value) return '';
  if (p.id === s.value.guesser) return t('popup.guesser');
  if (clueTime.value) return p.written ? t('popup.written') : t('popup.toWrite');
  return '';
};
/**
 * The small line under a clue card for everyone but the guesser: the writer's name, with whether the clue was cancelled or
 * picked as the best hint.
 * @param {{ name: string, cancelled?: boolean, best?: boolean }} c  a clue from the view
 * @returns {string}
 * Side effects: none.
 */
const writerLine = (c) => (c.cancelled ? t('table.writerCancelled', { name: c.name }) : c.best ? t('table.writerBest', { name: c.name }) : c.name);
// How many frame columns each slim bar spans: wider bars when four or fewer players are shown (a number, 3 or 2).
const barSpan = (count) => (count <= 4 ? 3 : 2);
// The grid style shared by every slim bar.
const barStyle = computed(() => ({ gridColumn: `span ${barSpan(others.value.length)}` }));
</script>

<template>
  <GameFrame class="table-view" :main-span="12" :log-span="5">
    <template #scorebar>
      <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :finished="state.phase === 'finished'" :awaiting="reveal && !mine?.ready" :waiting="waitingFor" :sticky="false" v-bind="scoreProps" @continue="send('ready')">
        <template #round>
          <section v-if="state.result" class="reveal stack" :aria-label="t('reveal.label')">
            <i18n-t :keypath="wordWasKey" scope="global" tag="p" class="reveal-word">
              <template #word><strong>{{ state.result.word }}</strong></template>
            </i18n-t>
            <p class="muted">
              <template v-if="state.result.guess?.passed">{{ t('reveal.passed', { name: state.result.guesserName }) }}</template>
              <template v-else-if="state.result.correct">{{ t('reveal.guessedRight', { name: state.result.guesserName, guess: state.result.guess?.text, points: state.result.guesserPoints }) }}</template>
              <template v-else>{{ t('reveal.guessedWrong', { name: state.result.guesserName, guess: state.result.guess?.text }) }}</template>
              <template v-if="state.result.bestName"> {{ t('reveal.bestHint', { name: state.result.bestName, points: state.result.bestPoints }) }}</template>
            </p>
            <ul class="entries">
              <li v-for="c in state.result.clues" :key="c.id" class="row" :class="{ cancelled: c.cancelled, best: c.best }">
                <span class="clue-text">{{ c.text }}</span>
                <span class="muted">{{ nameOf(c.id) }}</span>
                <span v-if="c.cancelled" class="tag">{{ t('table.cancelledTag') }}</span>
                <span v-else-if="c.best" class="tag best-tag">{{ t('table.bestTag') }}</span>
              </li>
            </ul>
          </section>
        </template>
      </ScoreBoard>
    </template>

    <template #main>
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <template v-if="opened.ai">
            <dt>{{ t('popup.plays') }}</dt>
            <dd>{{ opened.ai.name }}</dd>
          </template>
          <dt>{{ t('popup.score') }}</dt>
          <dd>{{ opened.score }}</dd>
          <template v-if="stageOf(opened)">
            <dt>{{ t('popup.now') }}</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>

      <div class="arena">
        <section class="word-card" :aria-label="t('table.secretWord')">
          <span class="caption muted">{{ isGuesser && !reveal && !ended ? t('table.secretWordHidden') : t('table.secretWord') }}</span>
          <strong class="word" :class="{ hidden: !state.word }">{{ state.word ?? '???' }}</strong>
        </section>

        <section class="clues-box" :aria-label="t('table.clues')">
          <!-- Writing the clues -->
          <form v-if="canWrite" class="clue-form" @submit.prevent="sendClue">
            <input v-model="clueText" maxlength="24" :placeholder="t('table.cluePlaceholder')" autocomplete="off" :aria-label="t('table.yourClue')" />
            <button type="submit" class="primary" :disabled="!clueText.trim()">{{ t('table.sendClue') }}</button>
          </form>
          <p v-else-if="clueTime && isGuesser" class="waiting muted">{{ t('table.thinking') }}</p>
          <ul v-if="clueTime" class="who-wrote" :aria-label="t('table.whoWritten')">
            <li v-for="p in writerList" :key="p.id" :class="{ done: p.written }">{{ p.name }}<span v-if="p.written"> &#10003;</span></li>
          </ul>

          <!-- Clues for the guesser: the ones that are left, with no writers -->
          <ul v-if="(guessing || choosing) && isGuesser" class="cards" :aria-label="t('table.theClues')">
            <li v-for="c in state.clues" :key="c.n">
              <button v-if="choosing" type="button" class="card pick" @click="send('best', { n: c.n })">{{ c.text }}</button>
              <span v-else class="card">{{ c.text }}</span>
            </li>
            <li v-if="!state.clues.length" class="none muted">{{ t('table.allCancelled') }}</li>
          </ul>

          <!-- Clues for everyone else, and for everybody once the turn is over -->
          <ul v-else-if="state.clues.length && !clueTime" class="cards" :aria-label="t('table.theClues')">
            <li v-for="c in state.clues" :key="c.id">
              <span class="card" :class="{ cancelled: c.cancelled, best: c.best }">
                <span class="text">{{ c.text }}</span>
                <small class="writer">{{ writerLine(c) }}</small>
              </span>
            </li>
          </ul>
        </section>

        <div class="action">
          <form v-if="canGuess" class="guess-form row" @submit.prevent="sendGuess">
            <input v-model="guessText" maxlength="40" :placeholder="t('table.guessPlaceholder')" autocomplete="off" :aria-label="t('table.yourGuess')" />
            <button type="submit" class="primary" :disabled="!guessText.trim()">{{ t('table.guess') }}</button>
            <button type="button" @click="send('pass')">{{ t('table.pass') }}</button>
          </form>
          <p v-else-if="choosing && state.guess" class="muted">{{ t('table.guessedRight', { name: guesserName, guess: state.guess.text }) }}</p>
        </div>
      </div>
    </template>

    <template #others>
      <ul v-if="others.length" class="bars" :aria-label="t('table.players')">
        <li v-for="p in others" :key="p.id" class="bar" :class="{ away: !p.online, guesser: p.id === state.guesser && !ended }" :style="barStyle">
          <strong class="who">{{ p.name }}</strong>
          <span v-if="p.id === state.guesser && !ended" class="tag guesser-tag">{{ t('table.guesserTag') }}</span>
          <span v-else-if="clueTime && p.written" class="tag done">{{ t('table.writtenTag') }}</span>
          <span v-if="!p.online" class="tag away">{{ t('common.away') }}</span>
          <span class="score">{{ p.score }}</span>
        </li>
      </ul>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingYet')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :turn="isGuesser && (guessing || choosing)" :lines="lines">
        <template #facts>
          <strong v-if="!ended">{{ t('facts.turn', { n: state.turn, total: state.turnsTotal }) }}</strong>
          <strong v-else>{{ t('facts.gameOver') }}</strong>
          <span v-if="!ended">{{ t('facts.guesser', { name: guesserName }) }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.word-card {
  flex: none;
  height: 6.2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  padding: 0.4rem 1rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.caption {
  font-size: 0.9rem;
}
.word {
  font-family: var(--display);
  font-size: 2.4rem;
  line-height: 1.1;
  color: var(--amber);
  text-align: center;
  overflow-wrap: anywhere;
}
.word.hidden {
  color: var(--muted);
  letter-spacing: 0.2em;
}
.clues-box {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.8rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.clue-form,
.guess-form {
  display: flex;
  gap: 0.5rem;
  flex-wrap: nowrap;
}
.clue-form input,
.guess-form input {
  flex: 1;
  min-width: 0;
}
.waiting,
.guess-note {
  margin: 0;
}
.who-wrote {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.who-wrote li {
  padding: 0.1rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
}
.who-wrote li.done {
  border-color: var(--moss);
  color: var(--moss);
}
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.card {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.55rem 1rem;
  min-width: 6rem;
  border: 2px solid var(--parchment);
  border-radius: 12px;
  background: #f4efe3;
  color: #2a1c05;
  font-family: var(--display);
  font-size: 1.35rem;
  line-height: 1.2;
}
button.card.pick {
  cursor: pointer;
}
button.card.pick:hover,
button.card.pick:focus-visible {
  border-color: var(--amber);
  box-shadow: 0 0 0 3px var(--amber);
}
.card.cancelled {
  opacity: 0.45;
}
.card.cancelled .text {
  text-decoration: line-through;
}
.card.best {
  border-color: var(--amber);
  box-shadow: 0 0 0 3px var(--amber);
}
.writer {
  font-family: var(--body);
  font-size: 0.75rem;
  color: #5a4a30;
}
.none {
  align-self: center;
}
.action {
  flex: none;
  min-height: 2.6rem;
  display: flex;
  align-items: center;
}
.action > * {
  flex: 1;
  margin: 0;
}

/* The slim bars for the other players, on the frame's own columns. */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.4rem var(--gap, 12px);
}
.bar {
  height: 2.3rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0 0.8rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
}
.bar.guesser {
  border-color: var(--amber);
}
.bar.away {
  opacity: 0.75;
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--display);
}
.tag {
  flex: none;
  font-size: 0.72rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.guesser-tag,
.tag.best-tag {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
}
.tag.done {
  background: var(--moss);
  border-color: var(--moss);
  color: #10200f;
}
.tag.away {
  color: var(--danger);
  border-color: var(--danger);
}
.score {
  margin-left: auto;
  flex: none;
  font-family: var(--display);
  font-size: 1.3rem;
  line-height: 1;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}

.reveal {
  margin-bottom: 0.8rem;
}
.reveal-word {
  margin: 0;
  font-size: 1.1rem;
}
.reveal-word strong {
  font-family: var(--display);
  color: var(--amber);
  font-size: 1.5rem;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.clue-text {
  font-weight: 700;
}
.entries li.cancelled .clue-text {
  text-decoration: line-through;
  opacity: 0.6;
}
</style>
