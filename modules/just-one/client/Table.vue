<script setup>
// The Just One table, for every phase of a game: the score bar, the secret word (hidden from the guesser), the clues and the
// controls for the moment, slim bars for the other players, and the two standard boxes along the bottom. The writers see the
// word and send one-word clues; the guesser sees the clues that were not cancelled, guesses once, and picks the best hint.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] },
});

const clueText = ref('');
const guessText = ref('');

const s = computed(() => props.state);
const phase = computed(() => s.value.phase);
const isGuesser = computed(() => s.value.guesser === s.value.you);
const clueTime = computed(() => phase.value === 'clues');
const guessing = computed(() => phase.value === 'guessing');
const choosing = computed(() => phase.value === 'choosing');
const reveal = computed(() => phase.value === 'reveal');
const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
const playing = computed(() => clueTime.value || guessing.value || choosing.value);
const mine = computed(() => s.value.players.find((p) => p.id === s.value.you));
const others = computed(() => s.value.players.filter((p) => p.id !== s.value.you));
const nameOf = (id) => s.value.players.find((p) => p.id === id)?.name ?? 'Someone';
const guesserName = computed(() => nameOf(s.value.guesser));
const writerList = computed(() => s.value.players.filter((p) => p.id !== s.value.guesser));
const writtenCount = computed(() => writerList.value.filter((p) => p.written).length);
const lastTurn = computed(() => s.value.turn >= s.value.turnsTotal);
const waitingFor = computed(() => (reveal.value ? s.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
const standings = computed(() => [...s.value.players].sort((a, b) => b.score - a.score));
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
const myClue = computed(() => s.value.clues.find((c) => c.own) ?? null);
const canWrite = computed(() => clueTime.value && !isGuesser.value && !myClue.value);
const canGuess = computed(() => guessing.value && isGuesser.value);
const ownCancelled = computed(() => (guessing.value || choosing.value) && !isGuesser.value && s.value.clues.some((c) => c.id === s.value.you && c.cancelled));

watch(
  () => `${s.value.turn}-${phase.value}`,
  () => {
    clueText.value = '';
    guessText.value = '';
  },
  { immediate: true },
);

const sendClue = () => props.send('clue', { text: clueText.value });
const sendGuess = () => props.send('guess', { text: guessText.value });

// ---- the words in the Status box ----
const headline = computed(() => {
  if (phase.value === 'abandoned') return 'The game was abandoned.';
  if (phase.value === 'finished') return `${winners.value.join(' and ')} ${winners.value.length > 1 ? 'win' : 'wins'} with ${standings.value[0].score} points.`;
  if (reveal.value) {
    const r = s.value.result;
    if (!r) return '';
    if (!r.correct) return r.guess?.passed ? `${r.guesserName} passed. The word was ${r.word}.` : `${r.guesserName} guessed “${r.guess?.text}”. The word was ${r.word}.`;
    return r.bestName ? `${r.guesserName} got it! ${r.bestName}'s hint was the best.` : `${r.guesserName} got it! Every hint was cancelled.`;
  }
  if (clueTime.value) {
    if (isGuesser.value) return `You are the guesser. The others are writing clues (${writtenCount.value} of ${writerList.value.length}).`;
    if (canWrite.value) return `Write a one-word clue for “${s.value.word}”. If somebody writes the same, both are cancelled.`;
    return `Clue sent. Waiting for the others (${writtenCount.value} of ${writerList.value.length}).`;
  }
  if (guessing.value) return isGuesser.value ? 'Your turn: read the clues and guess the word, or pass.' : `${guesserName.value} is guessing.`;
  if (choosing.value) return isGuesser.value ? 'Right! Now pick the best hint.' : `${guesserName.value} found the word, and is picking the best hint.`;
  return '';
});
const mineNow = computed(() => canWrite.value || (isGuesser.value && (guessing.value || choosing.value)));
const lines = computed(() => {
  if (phase.value === 'abandoned') return [{ text: 'Too many players left, so this game does not count towards the statistics.', tone: 'muted' }, 'Use Leave game (top right) to go back to the menu.'];
  if (phase.value === 'finished') return [{ text: 'Use Leave game (top right) to go back to the menu, or "All rounds" in the score bar to see every turn again.', tone: 'muted' }];
  if (reveal.value) {
    return [
      mine.value?.ready
        ? { text: `Waiting for ${waitingFor.value.join(', ')} to be ready${lastTurn.value ? ' for the final scores' : ' for the next turn'}.`, tone: 'muted' }
        : { text: 'Close the scores when you are ready to carry on.', tone: 'mine' },
    ];
  }
  if (ownCancelled.value) return [{ text: 'Your clue was cancelled: it matched another one.', tone: 'warn' }];
  if (canGuess.value) return [{ text: `Right: ${s.value.points.guesser} points for you, and ${s.value.points.bestHint} for the writer of the best hint. Wrong or pass: nobody scores.`, tone: 'muted' }];
  if (choosing.value && isGuesser.value) return [{ text: 'Click the clue that helped you most.', tone: 'muted' }];
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
const opened = computed(() => s.value.players.find((p) => p.id === openId.value) ?? null);
const stageOf = (p) => {
  if (ended.value) return '';
  if (p.id === s.value.guesser) return 'the guesser this turn';
  if (clueTime.value) return p.written ? 'has written a clue' : 'still to write a clue';
  return '';
};
const barSpan = (count) => (count <= 4 ? 3 : 2);
const barStyle = computed(() => ({ gridColumn: `span ${barSpan(others.value.length)}` }));
</script>

<template>
  <GameFrame class="table-view" :main-span="12" :log-span="5">
    <template #scorebar>
      <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :finished="state.phase === 'finished'" :awaiting="reveal && !mine?.ready" :waiting="waitingFor" :sticky="false" v-bind="scoreProps" @continue="send('ready')">
        <template #round>
          <section v-if="state.result" class="reveal stack" aria-label="This turn">
            <p class="reveal-word">The word was <strong>{{ state.result.word }}</strong></p>
            <p class="muted">
              <template v-if="state.result.guess?.passed">{{ state.result.guesserName }} passed.</template>
              <template v-else>{{ state.result.guesserName }} guessed “{{ state.result.guess?.text }}”: {{ state.result.correct ? `right (+${state.result.guesserPoints})` : 'wrong' }}.</template>
              <template v-if="state.result.bestName"> {{ state.result.bestName }} wrote the best hint (+{{ state.result.bestPoints }}).</template>
            </p>
            <ul class="entries">
              <li v-for="c in state.result.clues" :key="c.id" class="row" :class="{ cancelled: c.cancelled, best: c.best }">
                <span class="clue-text">{{ c.text }}</span>
                <span class="muted">{{ nameOf(c.id) }}</span>
                <span v-if="c.cancelled" class="tag">cancelled</span>
                <span v-else-if="c.best" class="tag best-tag">best hint</span>
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
            <dt>Plays</dt>
            <dd>{{ opened.ai.name }}</dd>
          </template>
          <dt>Score</dt>
          <dd>{{ opened.score }}</dd>
          <template v-if="stageOf(opened)">
            <dt>Now</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>

      <div class="arena">
        <section class="word-card" aria-label="The secret word">
          <span class="caption muted">{{ isGuesser && !reveal && !ended ? 'The secret word (hidden from you)' : 'The secret word' }}</span>
          <strong class="word" :class="{ hidden: !state.word }">{{ state.word ?? '???' }}</strong>
        </section>

        <section class="clues-box" aria-label="Clues">
          <!-- Writing the clues -->
          <form v-if="canWrite" class="clue-form" @submit.prevent="sendClue">
            <input v-model="clueText" maxlength="24" placeholder="One word" autocomplete="off" aria-label="Your clue" />
            <button type="submit" class="primary" :disabled="!clueText.trim()">Send clue</button>
          </form>
          <p v-else-if="clueTime && isGuesser" class="waiting muted">Clues are being written. Have a think about what the word could be.</p>
          <ul v-if="clueTime" class="who-wrote" aria-label="Who has written">
            <li v-for="p in writerList" :key="p.id" :class="{ done: p.written }">{{ p.name }}<span v-if="p.written"> &#10003;</span></li>
          </ul>

          <!-- Clues for the guesser: the ones that are left, with no writers -->
          <ul v-if="(guessing || choosing) && isGuesser" class="cards" aria-label="The clues">
            <li v-for="c in state.clues" :key="c.n">
              <button v-if="choosing" type="button" class="card pick" @click="send('best', { n: c.n })">{{ c.text }}</button>
              <span v-else class="card">{{ c.text }}</span>
            </li>
            <li v-if="!state.clues.length" class="none muted">Every clue was cancelled.</li>
          </ul>

          <!-- Clues for everyone else, and for everybody once the turn is over -->
          <ul v-else-if="state.clues.length && !clueTime" class="cards" aria-label="The clues">
            <li v-for="c in state.clues" :key="c.id">
              <span class="card" :class="{ cancelled: c.cancelled, best: c.best }">
                <span class="text">{{ c.text }}</span>
                <small class="writer">{{ c.name }}<template v-if="c.cancelled"> &middot; cancelled</template><template v-else-if="c.best"> &middot; best hint</template></small>
              </span>
            </li>
          </ul>
          <p v-if="state.guess && !guessing && !choosing && !reveal && !ended" class="muted guess-note">{{ guesserName }} guessed “{{ state.guess.text }}”.</p>
        </section>

        <div class="action">
          <form v-if="canGuess" class="guess-form row" @submit.prevent="sendGuess">
            <input v-model="guessText" maxlength="40" placeholder="Your one guess" autocomplete="off" aria-label="Your guess" />
            <button type="submit" class="primary" :disabled="!guessText.trim()">Guess</button>
            <button type="button" @click="send('pass')">Pass</button>
          </form>
          <p v-else-if="choosing && state.guess" class="muted">{{ guesserName }} guessed “{{ state.guess.text }}”, and it is right.</p>
        </div>
      </div>
    </template>

    <template #others>
      <ul v-if="others.length" class="bars" aria-label="Players">
        <li v-for="p in others" :key="p.id" class="bar" :class="{ away: !p.online, guesser: p.id === state.guesser && !ended }" :style="barStyle">
          <strong class="who">{{ p.name }}</strong>
          <span v-if="p.id === state.guesser && !ended" class="tag guesser-tag">guesser</span>
          <span v-else-if="clueTime && p.written" class="tag done">written</span>
          <span v-if="!p.online" class="tag away">away</span>
          <span class="score">{{ p.score }}</span>
        </li>
      </ul>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" empty="Nothing has happened yet." v-slot="{ entry }">{{ entry }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :turn="isGuesser && (guessing || choosing)" :lines="lines">
        <template #facts>
          <strong v-if="!ended">Turn {{ state.turn }} of {{ state.turnsTotal }}</strong>
          <strong v-else>Game over</strong>
          <span v-if="!ended">Guesser: {{ guesserName }}</span>
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
