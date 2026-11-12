<script setup>
// The Draw! table: two boards side by side, the guesses panel, and the score bar.  A guesser sees both drawings the
// same size with one box to type in; a drawer sees their own large with their tools under it and the other drawing
// small beside it.
//
// The line over each board says whose it is, and, for a word this viewer may not read, how long that word is: one
// blank per letter (`board.shape`, which never reveals a letter — see ../game.js).  Both views get it, so a drawer
// racing the other board has the same hint about it as the guessers do.  The scores are the bar alone until the game
// is over: this is a quick-fire game, and a pop-up between turns is a door shut in the middle of it.
//
// The drawings are not in the state: the strokes arrive as `draw` and `canvas` events, each tagged with the board
// they belong to (`board`, its place in the state's `boards`), and are handed to whichever board that is.  The word
// is deliberately not `slot`, which on this site is a member's place in a room and nothing to do with a canvas.
// See ../server.js.
//
// Props: state (the server's view), send (function), socket (to listen for strokes).  Emits: none.  Slots: none.
// Side effects: listens for `draw` and `canvas` on the socket while mounted; sends word, guess, line, fill, draw,
// undo, clear and canvas.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DrawingBoard from '../../../src/components/DrawingBoard.vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { useGameText } from '../../../src/useGameText.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useTurnClock } from '../../../src/useTurnClock.js';
import GuessPanel from './GuessPanel.vue';
import Toolbox from './Toolbox.vue';
import { boards as boardSizes } from './layout.js';
import { newTool } from './useTools.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  socket: { type: Object, required: true },
});
const { t } = useGameText();

const tool = newTool();
// One board component per board, in the order the server numbers them.
const panels = [ref(null), ref(null)];
const { secondsLeft } = useTurnClock(() => props.state);

const youDraw = computed(() => props.state.youDraw);
// Which board is this viewer's own (-1 for a guesser, who owns neither).
const mine = computed(() => props.state.boards.findIndex((board) => board.yours));
// The boards in the order they are shown: a drawer's own goes first, so it is the big one on the left.  `at` is the
// board's own number, kept through the reordering because it is what the stroke events are tagged with.
const shown = computed(() => {
  const list = props.state.boards.map((board, at) => ({ ...board, at }));
  return mine.value > 0 ? [list[mine.value], list[1 - mine.value]] : list;
});
// The frame measures its own main area and hands the size to the board, so the boards are sized from the room there
// is rather than from anything about the game: nothing moves while playing.
const sizesIn = (box) => boardSizes(box, youDraw.value);

/**
 * Hands strokes to the board they belong to.
 * @param {{ board: number, ops: object[] }} message  what the server sent
 * @returns {void}
 * Side effects: draws on one of the boards.
 */
const onDraw = ({ board, ops }) => panels[board]?.value?.apply(ops ?? []);

/**
 * A board as it now stands, in chunks: the first chunk replaces what was there, the rest are added.
 * @param {{ board: number, ops: object[], first: boolean }} message  what the server sent
 * @returns {void}
 * Side effects: redraws or adds to one of the boards.
 */
const onCanvas = ({ board, ops, first }) => {
  const panel = panels[board]?.value;
  if (!panel) return;
  if (first) panel.reset(ops ?? []);
  else panel.apply(ops ?? []);
};

onMounted(() => {
  props.socket.on('draw', onDraw);
  props.socket.on('canvas', onCanvas);
  props.send('canvas'); // whatever is already on the two boards, for somebody arriving mid-round
});
onBeforeUnmount(() => {
  props.socket.off('draw', onDraw);
  props.socket.off('canvas', onCanvas);
});

// A new turn means two blank boards, and the strokes of the one being drawn now.
watch(
  () => props.state.turn,
  async () => {
    await nextTick();
    for (const panel of panels) panel.value?.reset([]);
    props.send('canvas');
  },
);

// Another player's details open from their chip in the score bar.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => props.state.scoreboard.players,
  hostId: () => props.state.hostId,
  isHost: () => props.state.hostId === props.state.you,
  send: props.send, // removing a player, and the vote about one, are the same words in every game (usePlayerPopup)
  vote: () => props.state.vote ?? null,
});
const opened = computed(() => props.state.players.find((p) => p.id === openId.value) ?? null);

// What the Status box says, which is also what tells a player what to do next.
const status = computed(() => {
  const s = props.state;
  if (s.phase === 'finished') return { headline: t('status.over'), mine: false, lines: [] };
  if (s.phase === 'between') {
    const winner = s.reveal?.winner;
    if (!winner) return { headline: t('status.missed'), mine: false, lines: [] };
    if (winner.guesser === s.you) return { headline: t('status.wonIt'), mine: false, lines: [] };
    if (winner.drawer === s.you) return { headline: t('status.drewIt'), mine: false, lines: [] };
    return { headline: t('table.named', { guesser: nameOf(winner.guesser), drawer: nameOf(winner.drawer), word: winner.word }), mine: false, lines: [] };
  }
  if (s.phase === 'choosing') {
    if (!s.youDraw) return { headline: t('status.waiting'), mine: false, lines: [] };
    return s.choices.length ? { headline: t('status.choose'), mine: true, lines: [] } : { headline: t('status.chosen'), mine: false, lines: [] };
  }
  return s.youDraw ? { headline: t('status.draw'), mine: true, lines: [] } : { headline: t('status.guess'), mine: true, lines: [] };
});

/** A player's name by id. */
const nameOf = (id) => props.state.players.find((p) => p.id === id)?.name ?? '?';
</script>

<template>
  <GameFrame class="draw-table" :log-span="4">
    <template #scorebar>
      <ScoreBoard
        :players="state.scoreboard.players"
        :rounds="state.scoreboard.rounds"
        :low-is-better="state.scoreboard.lowIsBetter"
        :finished="state.phase === 'finished'"
        :round-popups="false"
        v-bind="scoreProps"
      />
    </template>

    <template #main="box">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>{{ t('table.guessing') }}</dt>
          <dd>{{ opened.score }}</dd>
        </dl>
      </PlayerPopup>

      <!-- The frame's main area is a subgrid, so everything on the table goes in one child that spans it all. -->
      <div class="table-area">
        <div class="boards">
          <figure v-for="(board, n) in shown" :key="board.at" class="board" :class="{ yours: board.yours, won: board.won }">
            <figcaption>
              <span class="who">
                <template v-if="board.yours && board.word">{{ t('table.yourWord', { word: board.word }) }}</template>
                <template v-else-if="board.word">{{ t('table.wasDrawing', { name: board.name, word: board.word }) }}</template>
                <template v-else>{{ t('table.theirBoard', { name: board.name }) }}</template>
              </span>
              <span v-if="!board.word && (board.shape ?? []).length" class="shape" :aria-label="t('table.wordShape')">
                <span v-for="(ch, at) in board.shape" :key="at" class="ch" :class="{ blank: ch === null }">{{ ch ?? '_' }}</span>
              </span>
            </figcaption>
            <DrawingBoard
              :ref="(el) => (panels[board.at].value = el)"
              :active="board.yours && state.phase === 'drawing'"
              :tool="tool"
              :width="n === 0 ? sizesIn(box).mine.width : sizesIn(box).theirs.width"
              :height="n === 0 ? sizesIn(box).mine.height : sizesIn(box).theirs.height"
              @ops="(ops) => send('draw', { ops })"
            />
          </figure>
        </div>

        <Toolbox v-if="youDraw && state.phase === 'drawing'" :tool="tool" @undo="send('undo')" @clear="send('clear')" />

        <div v-if="state.phase === 'choosing' && state.choices.length" class="choices row">
          <button v-for="(word, n) in state.choices" :key="word" class="primary" @click="send('word', { n })">{{ word }}</button>
        </div>
      </div>
    </template>

    <template #log>
      <GuessPanel
        :feed="state.feed"
        :can-guess="state.phase === 'drawing' && !youDraw"
        :max-length="state.limits.guessLength"
        @guess="(text) => send('guess', { text })"
      />
    </template>

    <template #status>
      <GameStatus :headline="status.headline" :mine="status.mine" :lines="status.lines">
        <template #facts>
          <strong>{{ t('table.turn', { n: state.turn, total: state.turns }) }}</strong>
          <span v-if="secondsLeft !== null">{{ secondsLeft }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
/* The main area of the frame is a subgrid of its twelve columns, so a child placed by itself would land in one of
   them; the table takes the whole width and lays its own pieces out down the middle. */
.table-area {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  min-height: 0;
}
.boards {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 12px;
}
.board {
  margin: 0;
  display: grid;
  gap: 0.2rem;
}
.board figcaption {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: var(--muted);
  height: 1.2rem;
  overflow: hidden;
  white-space: nowrap;
}
/* The hint is the useful half of the line, so the name gives way first when the board is the small one. */
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shape {
  flex: none;
  display: flex;
  gap: 0.15rem;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
  font-size: 0.95rem;
  letter-spacing: 0.05em;
  color: var(--parchment);
}
.ch {
  min-width: 0.7em;
  text-align: center;
}
.ch.blank {
  color: var(--muted);
}
.board.yours figcaption {
  color: var(--amber);
}
.board.won {
  outline: 2px solid var(--amber);
  outline-offset: 3px;
}
.choices {
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}
</style>
