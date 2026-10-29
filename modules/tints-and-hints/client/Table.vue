<script setup>
// The Tints and Hints table, for every phase of a game: the score bar, the colour grid (big, with square cells), the
// hint and guess controls beside it, slim bars for the other players, and the two standard boxes along the bottom.
// The hinter sees the secret tint and describes it, everyone else guesses twice, then the tint is revealed.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { cellColour } from '../grid.js';
import Board from './Board.vue';
import { barSpan, gridCell, gridSpan } from './layout.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] },
});

const kindText = { exact: 'Exactly right', close: 'Close', miss: 'Missed' };
const picked = ref(null);
const hintText = ref('');
const hintSaved = ref(false);

const s = computed(() => props.state);
const phase = computed(() => s.value.phase);
const isHinter = computed(() => s.value.hinter === s.value.you);
const guessing = computed(() => phase.value === 'guessing1' || phase.value === 'guessing2');
const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
const round = computed(() => (phase.value === 'guessing2' ? 2 : 1));
const hinterName = computed(() => s.value.players.find((p) => p.id === s.value.hinter)?.name ?? 'The hinter');
const guessers = computed(() => s.value.players.filter((p) => p.id !== s.value.hinter));
const guessedCount = computed(() => guessers.value.filter((p) => p.guessed).length);
const allGuessed = computed(() => guessedCount.value === guessers.value.length);
const mine = computed(() => s.value.players.find((p) => p.id === s.value.you));
const others = computed(() => s.value.players.filter((p) => p.id !== s.value.you));
const hint = computed(() => (round.value === 2 && s.value.hints.second ? s.value.hints.second : s.value.hints.first));
const lastTurn = computed(() => s.value.turn >= s.value.turnsTotal);
const reveal = computed(() => phase.value === 'reveal');
const waitingFor = computed(() => (reveal.value ? s.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
const hintGiven = computed(() => round.value === 2 || Boolean(s.value.hints.first)); // nobody guesses until the first hint is in
const canGuess = computed(() => guessing.value && !isHinter.value && !mine.value?.guessed && hintGiven.value);
const standings = computed(() => [...s.value.players].sort((a, b) => b.score - a.score));
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));

watch(
  () => `${s.value.turn}-${phase.value}`,
  () => {
    picked.value = null;
    hintText.value = isHinter.value && guessing.value ? (round.value === 2 ? s.value.hints.second : s.value.hints.first) : '';
    hintSaved.value = false;
  },
  { immediate: true },
);

const pick = (cell) => {
  if (canGuess.value) picked.value = cell;
};
async function lockIn() {
  if (!picked.value) return;
  const reply = await props.send('guess', { cell: picked.value });
  if (reply.ok) picked.value = null;
}
async function saveHint() {
  const reply = await props.send('hint', { text: hintText.value });
  hintSaved.value = reply.ok;
}

// ---- the words in the Status box ----
const headline = computed(() => {
  if (phase.value === 'abandoned') return 'The game was abandoned.';
  if (phase.value === 'finished') return `${winners.value.join(' and ')} ${winners.value.length > 1 ? 'win' : 'wins'} with ${standings.value[0].score} points.`;
  if (phase.value === 'reveal') return `The tint was ${s.value.tint}. ${s.value.result?.hinterName ?? hinterName.value} scores ${s.value.result?.hinterPoints ?? 0} for the hints.`;
  if (isHinter.value) return hintGiven.value ? 'Your turn to hint: describe your tint without naming the square.' : 'Your turn to hint: type a first hint describing your tint (without naming the square). Nobody can guess until you do.';
  if (!hintGiven.value) return `Waiting for ${hinterName.value}'s first hint.`;
  if (mine.value?.guessed) return `Guess locked in. Waiting for the others (${guessedCount.value} of ${guessers.value.length}).`;
  return round.value === 1 ? 'Your turn: listen to the hint and guess the tint.' : 'Here is a second hint. Where would you guess now?';
});
const mineNow = computed(() => guessing.value && (isHinter.value || canGuess.value)); // a guesser's turn starts once the first hint is in
const lines = computed(() => {
  if (phase.value === 'abandoned') return [{ text: 'Too many players left, so this game does not count towards the statistics.', tone: 'muted' }, 'Use Leave game (top right) to go back to the menu.'];
  if (phase.value === 'finished') return [{ text: 'Use Leave game (top right) to go back to the menu, or "All rounds" in the score bar to see every turn again.', tone: 'muted' }];
  if (phase.value === 'reveal') {
    return [
      'Every guess is on the grid.',
      mine.value?.ready
        ? { text: `Waiting for ${waitingFor.value.join(', ')} to be ready${lastTurn.value ? ' for the final scores' : ' for the next turn'}.`, tone: 'muted' }
        : { text: 'Close the scores when you are ready to carry on.', tone: 'mine' },
    ];
  }
  if (isHinter.value) return [`${guessedCount.value} of ${guessers.value.length} have guessed.`];
  return mine.value?.guessed ? [] : [{ text: picked.value ? `You have chosen ${picked.value}: lock it in when you are ready.` : 'Click a square on the grid.', tone: 'muted' }];
});

// ---- fitting the room: the grid is sized from the area the frame gives the table ----
const dims = (area) => {
  const span = gridSpan(area);
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  const width = Math.round(unit * span + area.gap * (span - 1));
  return { span, cell: gridCell(width, area.height) };
};

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
  if (p.id === s.value.hinter) return 'the hinter this turn';
  if (guessing.value) return p.guessed ? 'has guessed' : 'still to guess';
  return '';
};
const barStyle = computed(() => ({ gridColumn: `span ${barSpan(others.value.length)}` }));
</script>

<template>
  <GameFrame class="table-view" :main-span="8" :log-span="5">
    <template #scorebar>
      <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :finished="state.phase === 'finished'" :awaiting="reveal && !mine?.ready" :waiting="waitingFor" :sticky="false" v-bind="scoreProps" @continue="send('ready')">
        <template #round>
          <section v-if="state.result" class="reveal stack" aria-label="This turn">
            <div class="row">
              <span class="swatch small" :style="{ background: cellColour(state.result.tint) }" role="img" :aria-label="`The tint was ${state.result.tint}`">{{ state.result.tint }}</span>
              <div class="stack">
                <strong>The tint was {{ state.result.tint }}.</strong>
                <span class="muted">{{ state.result.hinterName }} scores {{ state.result.hinterPoints }} for the hints.</span>
              </div>
            </div>
            <ul class="entries">
              <li v-for="(e, i) in state.result.entries" :key="i" class="row">
                <span class="name">{{ e.name }}</span>
                <span class="muted">round {{ e.round }}, {{ e.cell }}</span>
                <span :class="e.kind">{{ kindText[e.kind] }}</span>
                <strong>+{{ e.points }}</strong>
              </li>
            </ul>
          </section>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <template v-if="opened.ai">
            <dt>Plays</dt>
            <dd>{{ opened.ai.name }}</dd>
          </template>
          <dt>Score</dt>
          <dd>{{ opened.score }}</dd>
          <dt>Colour</dt>
          <dd><span class="dot" :style="{ background: opened.colour }" /></dd>
          <template v-if="stageOf(opened)">
            <dt>Now</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>
      <div class="arena">
        <div class="grid-col" :style="{ gridColumn: `span ${dims(area).span}` }">
          <Board :guesses="state.guesses" :players="state.players" :target="state.tint" :selected="picked" :disabled="!canGuess" :cell="dims(area).cell" @pick="pick" />
        </div>

        <aside class="side" :style="{ gridColumn: `span ${area.columns - dims(area).span}` }" aria-label="Hints and guesses">
          <!-- The same blocks in every phase and for every role, so nothing moves: a block with nothing to show is empty. -->
          <div class="block swatch-row">
            <span
              v-if="state.tint && (isHinter || phase === 'reveal' || ended)"
              class="swatch"
              :style="{ background: cellColour(state.tint) }"
              role="img"
              :aria-label="isHinter && guessing ? `Your tint is ${state.tint}` : `The tint was ${state.tint}`"
              >{{ state.tint }}</span
            >
            <span v-else-if="guessing" class="swatch unknown" :style="picked ? { background: cellColour(picked) } : null">{{ picked ?? '??' }}</span>
            <span v-else class="swatch empty" />
            <p class="caption muted">
              <template v-if="isHinter && guessing">The secret tint only you can see.</template>
              <template v-else-if="guessing">Your current choice.</template>
              <template v-else-if="state.tint">The tint of this turn.</template>
            </p>
          </div>

          <div class="block action">
            <form v-if="isHinter && guessing" class="hint row" @submit.prevent="saveHint">
              <input v-model="hintText" maxlength="80" :placeholder="round === 1 ? 'Type your first hint' : 'Optional: a second hint'" aria-label="Hint" @input="hintSaved = false" />
              <button type="submit" :disabled="round === 1 && !hintText.trim()">{{ hintSaved ? 'Sent' : 'Send hint' }}</button>
            </form>
            <button v-else-if="canGuess" class="primary wide" :disabled="!picked" @click="lockIn">Lock in guess</button>
          </div>

          <div class="block action">
            <button v-if="isHinter && guessing" class="primary wide" :disabled="!allGuessed" @click="send('advance')">
              {{ round === 1 ? 'Continue to the second round' : 'Reveal the tint' }}
            </button>
          </div>

          <ol v-if="state.phase === 'finished'" class="standings" aria-label="Final scores">
            <li v-for="p in standings" :key="p.id" :class="{ top: p.winner }">
              <span class="place">{{ p.placement }}</span>
              <span class="who">{{ p.name }}</span>
              <span class="points">{{ p.score }}</span>
            </li>
          </ol>
          <p class="legend muted">
            Dotted rings are first guesses, solid rings are second guesses.
            <span v-if="mine" class="mark"><span class="dot" :style="{ background: mine.colour }" />your colour</span>
          </p>
        </aside>
      </div>
    </template>

    <template #others>
      <ul v-if="others.length" class="bars" aria-label="Players">
        <li v-for="p in others" :key="p.id" class="bar" :class="{ away: !p.online, hinter: p.id === state.hinter && !ended }" :style="barStyle">
          <span class="dot" :style="{ background: p.colour }" />
          <strong class="who">{{ p.name }}</strong>
          <span v-if="p.id === state.hinter && !ended" class="tag hint-tag">hinter</span>
          <span v-else-if="guessing && p.guessed" class="tag done">guessed</span>
          <span v-if="!p.online" class="tag away">away</span>
          <span class="score">{{ p.score }}</span>
        </li>
      </ul>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" empty="Nothing has happened yet." v-slot="{ entry }">{{ entry }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :turn="guessing && isHinter" :lines="lines">
        <template #facts>
          <strong v-if="!ended">Turn {{ state.turn }} of {{ state.turnsTotal }}</strong>
          <strong v-else>Game over</strong>
          <span v-if="guessing">Round {{ round }} of 2</span>
          <span v-if="!ended">Hinter: {{ hinterName }}</span>
        </template>
        <p v-if="guessing && !isHinter" class="hint-text" :class="{ hidden: !hint }">&ldquo;{{ hint }}&rdquo;</p>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  min-height: 0;
}
.grid-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: flex-start;
}
.side {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.7rem 0.8rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.block {
  flex: none;
}
.swatch-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  height: 5rem;
}
.caption {
  margin: 0;
  font-size: 0.9rem;
}
.action {
  height: 2.6rem;
  display: flex;
  align-items: stretch;
}
.action > * {
  flex: 1;
}
.wide {
  width: 100%;
}
.hint {
  flex-wrap: nowrap;
  gap: 0.4rem;
}
.hint input {
  flex: 1;
  min-width: 0;
}
.swatch {
  display: grid;
  place-items: center;
  width: 5rem;
  height: 5rem;
  flex: none;
  border-radius: 12px;
  border: 2px solid var(--parchment);
  font-weight: 700;
  font-size: 1.2rem;
  color: #fff;
  text-shadow: 0 0 4px #000, 0 0 4px #000;
}
.swatch.small {
  width: 4rem;
  height: 4rem;
  font-size: 1rem;
}
.swatch.unknown {
  background: #fff;
  color: #000;
  text-shadow: none;
}
.swatch.empty {
  border-style: dashed;
  border-color: var(--line);
}
.standings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: 0;
  overflow-y: auto;
}
.standings li {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.standings li.top .who {
  color: var(--amber);
}
.place {
  width: 1.2rem;
  color: var(--muted);
}
.standings .who {
  flex: 1;
}
.points {
  font-family: var(--display);
  color: var(--amber);
}
.legend {
  margin: auto 0 0;
  font-size: 0.85rem;
}
.mark {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.5rem;
}
.dot {
  display: inline-block;
  vertical-align: middle;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}

/* The slim bars for the other players, on the frame's own columns. */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr)); /* the frame's own 12 columns and gutter */
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
.bar.hinter {
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
.tag.hint-tag {
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

.hint-text {
  font-family: var(--display);
  font-size: 1.1rem;
  line-height: 1.3;
  margin: 0;
  color: var(--amber);
}
.hint-text.hidden {
  visibility: hidden;
}
.reveal {
  margin-bottom: 0.8rem;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.name {
  font-weight: 600;
}
.exact {
  color: var(--moss);
}
.close {
  color: var(--amber);
}
.miss {
  color: var(--muted);
}
</style>
