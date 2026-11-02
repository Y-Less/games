<script setup>
// The Scribblers table: the score bar, the word and the clock, the drawing board (with the drawer's toolbox under it),
// the guesses panel beside it, and the two standard boxes along the bottom.
//
// The board is the one part of a game in this hub that does not come from the view: a drawing is thousands of
// instructions a turn, so the server relays them as they are made (`draw`) and sends the whole board to anybody who
// arrives in the middle of a turn (`canvas`).  Everything else - the word, the hints, the guesses, the scores - is the
// view, like every other game.
//
// Props: state (the server's view), send (function: (event, payload) -> Promise<{ ok, error }>), socket (the module's
// socket, for the drawing events), log (Recent moves, kept by Scribblers.vue, see moveLog.js).
// Emits: none.  Slots: none (it fills GameFrame's scorebar, main, log, and status slots).
// Side effects: listens for `draw` and `canvas` on the socket while it is mounted; sends 'word', 'guess', 'ready',
// 'canvas', 'line', 'draw', 'fill', 'undo', 'clear', 'removeBot' and 'kick' requests.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import { useTurnClock } from '../../../src/useTurnClock.js';
import Board from './Board.vue';
import GuessPanel from './GuessPanel.vue';
import Toolbox from './Toolbox.vue';
import WordBar from './WordBar.vue';
import { boardSize, boardSpan } from './layout.js';
import { useTools } from './useTools.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  socket: { type: Object, required: true },
  log: { type: Array, default: () => [] },
});
const { t, text, list } = useGameText();

const s = computed(() => props.state);
const phase = computed(() => s.value.phase);
const choosing = computed(() => phase.value === 'choosing');
const drawing = computed(() => phase.value === 'drawing');
const between = computed(() => phase.value === 'between');
const scores = computed(() => phase.value === 'scores');
const ended = computed(() => phase.value === 'finished');
// You are drawing this turn.
const youDraw = computed(() => Boolean(s.value.youDraw));
// Your own player entry.
const mine = computed(() => s.value.players.find((p) => p.id === s.value.you) ?? null);
// You may type: a guess while somebody is drawing, or a word to the others at any other point in a turn.
const canType = computed(() => Boolean(mine.value) && !ended.value && (drawing.value || choosing.value || between.value || scores.value));
// The seconds left of whatever is being timed, counted down here from what the server said was left.  It is shown only
// while a word is being chosen or drawn: the short wait between turns is not something anybody is racing.
const { secondsLeft } = useTurnClock(() => s.value);
const clock = computed(() => (choosing.value || drawing.value ? secondsLeft.value : null));
// The people who have yet to close the round's scores.
const waitingFor = computed(() => (scores.value ? s.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
// The players by score, best first, and the winners' names once the game is over.
const standings = computed(() => [...s.value.players].sort((a, b) => b.score - a.score));
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
// Everybody who is guessing this turn, and how many of them have found the word.
const guessers = computed(() => s.value.players.filter((p) => p.id !== s.value.drawer));
const gotIt = computed(() => guessers.value.filter((p) => p.guessed).length);

// ---- the board ----
const board = ref(null); // the Board component, which owns the canvas
const { tool } = useTools({ active: () => youDraw.value && drawing.value, undo: () => props.send('undo') });

/**
 * Draws instructions somebody else has made.
 * @param {{ ops: object[] }} message  what the server relayed
 * @returns {void}
 * Side effects: draws on the board.
 */
const onDraw = (message) => board.value?.apply(message?.ops ?? []);

/**
 * The board as it now stands, in chunks: the first chunk starts it afresh, the rest are added to it.
 * @param {{ ops: object[], first: boolean }} message  one chunk
 * @returns {void}
 * Side effects: draws on the board.
 */
const onCanvas = (message) => {
  if (message?.first) board.value?.reset(message.ops ?? []);
  else board.value?.apply(message?.ops ?? []);
};

/**
 * Asks the server for the board as it stands (after arriving, or coming back, in the middle of a turn).
 * @returns {void}
 * Side effects: sends a 'canvas' request.
 */
function askForBoard() {
  if (drawing.value || between.value) props.send('canvas');
}

/**
 * Sends what the player has just drawn: one stroke as a `line` (the shape scribble.rs's protocol has), a fill as a
 * `fill`, and anything more as one `draw` batch.
 * @param {object[]} ops  the instructions made since the last frame
 * @returns {void}
 * Side effects: sends a request.
 */
function sendOps(ops) {
  if (ops.length === 1) {
    const [op] = ops;
    const { t: kind, ...rest } = op;
    props.send(kind, rest);
    return;
  }
  props.send('draw', { ops });
}

onMounted(() => {
  props.socket.on('draw', onDraw);
  props.socket.on('canvas', onCanvas);
  props.socket.on('connect', askForBoard);
  askForBoard();
});
onBeforeUnmount(() => {
  props.socket.off('draw', onDraw);
  props.socket.off('canvas', onCanvas);
  props.socket.off('connect', askForBoard);
});

// Each turn starts on a blank board; then the server is asked for anything already drawn on it.
watch(
  () => `${s.value.round}:${s.value.turn}`,
  () => {
    board.value?.reset([]);
    askForBoard();
  },
);

/**
 * How the main area is shared out: how many of the frame's columns the board's side takes, and how big the canvas is.
 * @param {{ width: number, height: number, gap: number, columns: number }} area  the main slot's measurements
 * @returns {{ span: number, board: { width: number, height: number }, panel: number }} columns, canvas size, panel height
 * Side effects: none.
 */
function dims(area) {
  const withToolbox = youDraw.value && drawing.value;
  const span = boardSpan(area, withToolbox);
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  const across = Math.round(unit * span + area.gap * (span - 1));
  return { span, board: boardSize(area, across, withToolbox), panel: Math.max(160, area.height) };
}

// ---- the words in the Status box ----
// The one line that matters now.
const headline = computed(() => {
  if (ended.value) return t('status.wins', { names: list(winners.value), score: standings.value[0]?.score ?? 0, count: winners.value.length }, winners.value.length);
  if (scores.value) return t('status.roundOver', { n: s.value.round, of: s.value.rounds });
  if (between.value) return s.value.reveal?.word ? t('status.wordWas', { word: s.value.reveal.word }) : t('status.turnOver');
  if (choosing.value) return youDraw.value ? t('status.yourChoice') : t('status.choosing', { name: s.value.drawerName });
  if (drawing.value) {
    if (youDraw.value) return t('status.youDraw', { word: s.value.word });
    if (s.value.youGuessed) return t('status.youGotIt');
    return t('status.guess', { name: s.value.drawerName });
  }
  return '';
});
// It is your move (the Status box takes the accent colour, and the "your turn" pop-up follows it): you are choosing a
// word or drawing one.
const mineNow = computed(() => youDraw.value && (choosing.value || drawing.value));
// The further Status lines.
const lines = computed(() => {
  if (ended.value) return [{ text: t('status.finishedNote'), tone: 'muted' }];
  if (scores.value) {
    return [mine.value?.ready ? { text: t('status.waitingReady', { names: list(waitingFor.value) }), tone: 'muted' } : { text: t('status.closeScores'), tone: 'mine' }];
  }
  if (between.value) {
    const reveal = s.value.reveal;
    if (!reveal) return [];
    if (reveal.reason === 'drawerAway') return [{ text: t('status.drawerLeft'), tone: 'warn' }];
    return [{ text: reveal.guessed.length ? t('status.gotItCount', { count: reveal.guessed.length }, reveal.guessed.length) : t('status.nobodyGotIt'), tone: 'muted' }];
  }
  if (drawing.value && youDraw.value) return [{ text: t('status.gotSoFar', { count: gotIt.value, total: guessers.value.length }), tone: 'muted' }];
  if (drawing.value && s.value.youGuessed) return [{ text: t('status.waitForTheRest'), tone: 'muted' }];
  if (drawing.value) return [{ text: t('status.typeYourGuess'), tone: 'muted' }];
  return [];
});

// ---- the player pop-up ----
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
 * @param {object} p  a player from the view
 * @returns {string} the phrase, or '' when there is nothing to say
 * Side effects: none.
 */
const stageOf = (p) => {
  if (ended.value) return '';
  if (p.id === s.value.drawer) return choosing.value ? t('popup.choosing') : t('popup.drawing');
  if (drawing.value) return p.guessed ? t('popup.gotIt') : t('popup.guessing');
  return '';
};
</script>

<template>
  <GameFrame class="table-view" :main-span="8" :log-span="5">
    <template #scorebar>
      <ScoreBoard
        :players="state.scoreboard.players"
        :rounds="state.scoreboard.rounds"
        :low-is-better="state.scoreboard.lowIsBetter"
        :finished="ended"
        :awaiting="scores && !mine?.ready"
        :waiting="waitingFor"
        :sticky="false"
        v-bind="scoreProps"
        @continue="send('ready')"
      />
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>{{ t('popup.score') }}</dt>
          <dd>{{ opened.score }}</dd>
          <dt>{{ t('popup.lastTurn') }}</dt>
          <dd>{{ opened.lastScore }}</dd>
          <template v-if="stageOf(opened)">
            <dt>{{ t('popup.now') }}</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>

      <div class="arena">
        <div class="board-side" :style="{ gridColumn: `span ${dims(area).span}` }">
          <WordBar :hints="state.hints" :seconds-left="clock" :you-draw="youDraw" :drawer-name="state.drawerName ?? ''" :phase="phase" />

          <div class="board-holder" :style="{ height: `${dims(area).board.height}px`, width: `${dims(area).board.width}px` }">
            <Board ref="board" :active="youDraw && drawing" :tool="tool" :width="dims(area).board.width" :height="dims(area).board.height" @ops="sendOps" />

            <!-- The drawer chooses a word: over the board, which is blank anyway. -->
            <div v-if="choosing && youDraw && state.choices.length" class="over stack" :aria-label="t('choice.label')">
              <p class="over-title">{{ t('choice.pick') }}</p>
              <div class="choices">
                <button v-for="(word, n) in state.choices" :key="word" type="button" class="primary" @click="send('word', { n })">{{ word }}</button>
              </div>
              <p class="muted">{{ t('choice.orWait') }}</p>
            </div>

            <!-- The turn is over: the word, and what everybody scored. -->
            <div v-else-if="between && state.reveal" class="over stack" :aria-label="t('reveal.label')">
              <p class="over-title">{{ t('reveal.wordWas', { word: state.reveal.word ?? '' }) }}</p>
              <ul class="points">
                <li v-for="p in state.players.filter((q) => state.reveal.points[q.id])" :key="p.id">
                  <span class="who">{{ p.name }}</span>
                  <strong>{{ t('reveal.points', { n: state.reveal.points[p.id] }) }}</strong>
                </li>
                <li v-if="!Object.keys(state.reveal.points).length" class="muted">{{ t('reveal.nobody') }}</li>
              </ul>
            </div>
          </div>

          <Toolbox v-if="youDraw && drawing" :tool="tool" @undo="send('undo')" @clear="send('clear')" />
        </div>

        <div class="panel-side" :style="{ gridColumn: `span ${area.columns - dims(area).span}` }">
          <GuessPanel :feed="state.feed" :can-guess="canType" :you-draw="youDraw" :height="dims(area).panel" @guess="(typed) => send('guess', { text: typed })" />
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingYet')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :lines="lines">
        <template #facts>
          <strong v-if="!ended">{{ t('facts.round', { n: state.round, total: state.rounds }) }}</strong>
          <strong v-else>{{ t('facts.gameOver') }}</strong>
          <span v-if="!ended && state.turns">{{ t('facts.turn', { n: Math.min(state.turn, state.turns), total: state.turns }) }}</span>
          <span v-if="!ended && state.drawerName">{{ t('facts.drawer', { name: state.drawerName }) }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  height: 100%;
  min-height: 0;
}
.board-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  min-height: 0;
}
.board-holder {
  position: relative;
  flex: none;
}
.panel-side {
  min-width: 0;
  min-height: 0;
}
/* The word choice and the turn's word sit over the board, so nothing on the table moves when they come and go. */
.over {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 1rem;
  text-align: center;
  background: color-mix(in srgb, var(--bg-raised) 92%, transparent);
  border-radius: var(--radius);
}
.over-title {
  margin: 0;
  font-size: 1.2rem;
  color: var(--amber);
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}
.points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  max-height: 60%;
  overflow-y: auto;
}
.points li {
  display: flex;
  gap: 0.6rem;
  justify-content: center;
}
.who {
  color: var(--muted);
}
</style>
