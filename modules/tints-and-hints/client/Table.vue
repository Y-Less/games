<script setup>
// Props: state {Object, required} the player's view of the game; send {Function, required} sends a request to the server
// (returns a promise of {ok}); log {Array} the Recent moves lines.
// Emits: none (requests go through `send`: hint, guess, ready, advance, kick, removeBot).  Slots: none (fills GameFrame's slots).
// Side effects: a watcher resets the picked square and hint text on each new turn or phase; saving a hint or locking in a guess sends to the server.
// The Tints and Hints table, for every phase of a game: the score bar, the colour grid (big, with square cells), the
// hint and guess controls beside it, slim bars for the other players, and the two standard boxes along the bottom.
// The hinter sees the secret tint and describes it, everyone else guesses twice, then the tint is revealed.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { useGameText } from '../../../src/useGameText.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { cellColour } from '../grid.js';
import Board from './Board.vue';
import { barSpan, gridCell, gridSpan } from './layout.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] },
});

const { t, text, list } = useGameText();

// The square chosen on the grid but not yet locked in.
const picked = ref(null);
// The hinter's hint text as typed.
const hintText = ref('');
// True once the typed hint has been saved to the server (reset on a new turn).
const hintSaved = ref(false);

// Shorthand for the current state, to keep the computed values below short.
const s = computed(() => props.state);
// The current phase (guessing1, guessing2, reveal, finished, abandoned).
const phase = computed(() => s.value.phase);
// True when you are this turn's hinter.
const isHinter = computed(() => s.value.hinter === s.value.you);
// True during either guessing round.
const guessing = computed(() => phase.value === 'guessing1' || phase.value === 'guessing2');
// True when the game is over (finished or abandoned).
const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
// The guessing round number: 2 in the second round, otherwise 1.
const round = computed(() => (phase.value === 'guessing2' ? 2 : 1));
// The hinter's name, with a fallback while they are not in the list.
const hinterName = computed(() => s.value.players.find((p) => p.id === s.value.hinter)?.name ?? t('table.theHinter'));
// Everyone except the hinter.
const guessers = computed(() => s.value.players.filter((p) => p.id !== s.value.hinter));
// How many guessers have locked in a guess this round.
const guessedCount = computed(() => guessers.value.filter((p) => p.guessed).length);
// True when every guesser has guessed.
const allGuessed = computed(() => guessedCount.value === guessers.value.length);
// Your own entry in the player list.
const mine = computed(() => s.value.players.find((p) => p.id === s.value.you));
// Everyone except you, shown as slim bars.
const others = computed(() => s.value.players.filter((p) => p.id !== s.value.you));
// The hint to show now: the second one in round two if it exists, otherwise the first.
const hint = computed(() => (round.value === 2 && s.value.hints.second ? s.value.hints.second : s.value.hints.first));
// True on the game's final turn.
const lastTurn = computed(() => s.value.turn >= s.value.turnsTotal);
// True while the tint is being revealed.
const reveal = computed(() => phase.value === 'reveal');
// Names of players who have not yet closed the reveal scores.
const waitingFor = computed(() => (reveal.value ? s.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
// True once there is a hint to guess from.
const hintGiven = computed(() => round.value === 2 || Boolean(s.value.hints.first)); // nobody guesses until the first hint is in
// True when you may pick and lock in a guess now.
const canGuess = computed(() => guessing.value && !isHinter.value && !mine.value?.guessed && hintGiven.value);
// Players ordered by score, highest first.
const standings = computed(() => [...s.value.players].sort((a, b) => b.score - a.score));
// Names of the winning players (more than one means a tie).
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));

// Each new turn or phase clears the picked square and re-seeds the hint box from any hint already given.
watch(
  () => `${s.value.turn}-${phase.value}`,
  () => {
    picked.value = null;
    hintText.value = isHinter.value && guessing.value ? (round.value === 2 ? s.value.hints.second : s.value.hints.first) : '';
    hintSaved.value = false;
  },
  { immediate: true },
);

/**
 * Selects a square on the grid, if guessing is allowed now.
 * @param {string} cell  the square's name (for example "C4")
 * @returns {void}
 * Side effects: sets `picked`.
 */
const pick = (cell) => {
  if (canGuess.value) picked.value = cell;
};
/**
 * Sends the picked square to the server as your guess.
 * @returns {Promise<void>} resolves once the server has replied
 * Side effects: sends a 'guess' request; clears `picked` if it was accepted.
 */
async function lockIn() {
  if (!picked.value) return;
  const reply = await props.send('guess', { cell: picked.value });
  if (reply.ok) picked.value = null;
}
/**
 * Sends the typed hint to the server.
 * @returns {Promise<void>} resolves once the server has replied
 * Side effects: sends a 'hint' request; sets `hintSaved` to whether it was accepted.
 */
async function saveHint() {
  const reply = await props.send('hint', { text: hintText.value });
  hintSaved.value = reply.ok;
}

// ---- the words in the Status box ----
// The one-line headline for the Status box describing what is happening now.
const headline = computed(() => {
  if (phase.value === 'abandoned') return t('status.abandoned');
  if (phase.value === 'finished') return t('status.wins', { names: list(winners.value), score: standings.value[0].score }, winners.value.length);
  if (phase.value === 'reveal') return t('reveal.summary', { cell: s.value.tint, name: s.value.result?.hinterName ?? hinterName.value, points: s.value.result?.hinterPoints ?? 0 });
  if (isHinter.value) return hintGiven.value ? t('status.hintAgain') : t('status.hintFirst');
  if (!hintGiven.value) return t('status.waitingFirstHint', { name: hinterName.value });
  if (mine.value?.guessed) return t('status.lockedIn', { guessed: guessedCount.value, total: guessers.value.length });
  return round.value === 1 ? t('status.guessFirst') : t('status.guessSecond');
});
// True when it is your move (hint or guess), which highlights the Status box.
const mineNow = computed(() => guessing.value && (isHinter.value || canGuess.value)); // a guesser's turn starts once the first hint is in
// Extra Status lines for the current phase (strings, or { text, tone } objects).
const lines = computed(() => {
  if (phase.value === 'abandoned') return [{ text: t('status.abandonedNote'), tone: 'muted' }, t('status.leaveToMenu')];
  if (phase.value === 'finished') return [{ text: t('status.finishedNote'), tone: 'muted' }];
  if (phase.value === 'reveal') {
    const names = list(waitingFor.value);
    return [
      t('status.everyGuess'),
      mine.value?.ready
        ? { text: lastTurn.value ? t('status.waitingReadyFinal', { names }) : t('status.waitingReadyNext', { names }), tone: 'muted' }
        : { text: t('status.closeScores'), tone: 'mine' },
    ];
  }
  if (isHinter.value) return [t('status.guessedCount', { guessed: guessedCount.value, total: guessers.value.length })];
  return mine.value?.guessed ? [] : [{ text: picked.value ? t('status.chosen', { cell: picked.value }) : t('status.clickSquare'), tone: 'muted' }];
});

// ---- fitting the room: the grid is sized from the area the frame gives the table ----
/**
 * Works out how many columns the grid spans and how big each square is for the room given.
 * @param {{width: number, height: number, gap: number, columns: number}} area  the main slot's measurements
 * @returns {{span: number, cell: number}} frame columns for the grid, and square side in pixels
 * Side effects: none.
 */
const dims = (area) => {
  const span = gridSpan(area);
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  const width = Math.round(unit * span + area.gap * (span - 1));
  return { span, cell: gridCell(width, area.height) };
};

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button).  The scoreboard's ids are the accounts' ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostId,
  isHost: () => s.value.you === s.value.hostId,
  remove: (id, player) => (player?.bot ? props.send('removeBot', { seat: id }) : props.send('kick', { userId: id })),
});
// The player whose popup is open, or null.
const opened = computed(() => s.value.players.find((p) => p.id === openId.value) ?? null);
// Returns a short phrase for what a player is doing this turn ('' once the game has ended).
const stageOf = (p) => {
  if (ended.value) return '';
  if (p.id === s.value.hinter) return t('popup.hinterNow');
  if (guessing.value) return p.guessed ? t('popup.hasGuessed') : t('popup.stillToGuess');
  return '';
};
// Grid style making each slim bar span the right number of columns for the number of others.
const barStyle = computed(() => ({ gridColumn: `span ${barSpan(others.value.length)}` }));
</script>

<template>
  <GameFrame class="table-view" :main-span="8" :log-span="5">
    <template #scorebar>
      <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :finished="state.phase === 'finished'" :awaiting="reveal && !mine?.ready" :waiting="waitingFor" :sticky="false" v-bind="scoreProps" @continue="send('ready')">
        <template #round>
          <section v-if="state.result" class="reveal stack" :aria-label="t('table.thisTurn')">
            <div class="row">
              <span class="swatch small" :style="{ background: cellColour(state.result.tint) }" role="img" :aria-label="t('reveal.tintWas', { cell: state.result.tint })">{{ state.result.tint }}</span>
              <div class="stack">
                <strong>{{ t('reveal.tintWas', { cell: state.result.tint }) }}</strong>
                <span class="muted">{{ t('reveal.hinterScores', { name: state.result.hinterName, points: state.result.hinterPoints }) }}</span>
              </div>
            </div>
            <ul class="entries">
              <li v-for="(e, i) in state.result.entries" :key="i" class="row">
                <span class="name">{{ e.name }}</span>
                <span class="muted">{{ t('reveal.entry', { round: e.round, cell: e.cell }) }}</span>
                <span :class="e.kind">{{ t(`reveal.kind.${e.kind}`) }}</span>
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
            <dt>{{ t('popup.plays') }}</dt>
            <dd>{{ opened.ai.name }}</dd>
          </template>
          <dt>{{ t('popup.score') }}</dt>
          <dd>{{ opened.score }}</dd>
          <dt>{{ t('popup.colour') }}</dt>
          <dd><span class="dot" :style="{ background: opened.colour }" /></dd>
          <template v-if="stageOf(opened)">
            <dt>{{ t('popup.now') }}</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>
      <div class="arena">
        <div class="grid-col" :style="{ gridColumn: `span ${dims(area).span}` }">
          <Board :guesses="state.guesses" :players="state.players" :target="state.tint" :selected="picked" :disabled="!canGuess" :cell="dims(area).cell" @pick="pick" />
        </div>

        <aside class="side" :style="{ gridColumn: `span ${area.columns - dims(area).span}` }" :aria-label="t('table.hintsAndGuesses')">
          <!-- The same blocks in every phase and for every role, so nothing moves: a block with nothing to show is empty. -->
          <div class="block swatch-row">
            <span
              v-if="state.tint && (isHinter || phase === 'reveal' || ended)"
              class="swatch"
              :style="{ background: cellColour(state.tint) }"
              role="img"
              :aria-label="isHinter && guessing ? t('table.yourTint', { cell: state.tint }) : t('reveal.tintWas', { cell: state.tint })"
              >{{ state.tint }}</span
            >
            <span v-else-if="guessing" class="swatch unknown" :style="picked ? { background: cellColour(picked) } : null">{{ picked ?? '??' }}</span>
            <span v-else class="swatch empty" />
            <p class="caption muted">
              <template v-if="isHinter && guessing">{{ t('table.captionSecret') }}</template>
              <template v-else-if="guessing">{{ t('table.captionChoice') }}</template>
              <template v-else-if="state.tint">{{ t('table.captionTint') }}</template>
            </p>
          </div>

          <div class="block action">
            <form v-if="isHinter && guessing" class="hint row" @submit.prevent="saveHint">
              <input v-model="hintText" maxlength="80" :placeholder="round === 1 ? t('table.firstHint') : t('table.secondHint')" :aria-label="t('table.hint')" @input="hintSaved = false" />
              <button type="submit" :disabled="round === 1 && !hintText.trim()">{{ hintSaved ? t('table.sent') : t('table.sendHint') }}</button>
            </form>
            <button v-else-if="canGuess" class="primary wide" :disabled="!picked" @click="lockIn">{{ t('table.lockIn') }}</button>
          </div>

          <div class="block action">
            <button v-if="isHinter && guessing" class="primary wide" :disabled="!allGuessed" @click="send('advance')">
              {{ round === 1 ? t('table.secondRound') : t('table.revealTint') }}
            </button>
          </div>

          <ol v-if="state.phase === 'finished'" class="standings" :aria-label="t('scoreboard.final')">
            <li v-for="p in standings" :key="p.id" :class="{ top: p.winner }">
              <span class="place">{{ p.placement }}</span>
              <span class="who">{{ p.name }}</span>
              <span class="points">{{ p.score }}</span>
            </li>
          </ol>
          <p class="legend muted">
            {{ t('table.legend') }}
            <span v-if="mine" class="mark"><span class="dot" :style="{ background: mine.colour }" />{{ t('table.yourColour') }}</span>
          </p>
        </aside>
      </div>
    </template>

    <template #others>
      <ul v-if="others.length" class="bars" :aria-label="t('table.players')">
        <li v-for="p in others" :key="p.id" class="bar" :class="{ away: !p.online, hinter: p.id === state.hinter && !ended }" :style="barStyle">
          <span class="dot" :style="{ background: p.colour }" />
          <strong class="who">{{ p.name }}</strong>
          <span v-if="p.id === state.hinter && !ended" class="tag hint-tag">{{ t('table.hinterTag') }}</span>
          <span v-else-if="guessing && p.guessed" class="tag done">{{ t('table.guessedTag') }}</span>
          <span v-if="!p.online" class="tag away">{{ t('common.away') }}</span>
          <span class="score">{{ p.score }}</span>
        </li>
      </ul>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingYet')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :turn="guessing && isHinter" :lines="lines">
        <template #facts>
          <strong v-if="!ended">{{ t('facts.turn', { n: state.turn, total: state.turnsTotal }) }}</strong>
          <strong v-else>{{ t('facts.gameOver') }}</strong>
          <span v-if="guessing">{{ t('facts.round', { n: round }) }}</span>
          <span v-if="!ended">{{ t('facts.hinter', { name: hinterName }) }}</span>
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
