<script setup>
// The Azulejo table: the display plates and the centre, your board (prominent) and everyone else's beside it, the
// scoreboard, a log, the wall-tiling summary, and the final breakdown.  The server sends the view; every action is one
// request: `move` (take a colour group and place it) or `column` (free wall only).
//
// Props:
//   state  {Object}    required.  The player's view of the game (phases playing, tiling, finished).
//   send   {Function}  required. send(action, payload) returns a promise of { ok, error? } from the server.
// Emits: none.
// Slots: none (fills GameFrame's scorebar, main, log, and status slots).
// Side effects: sends `move`, `column`, `again`, `kick`, and `removeBot` requests; keeps local selection/hover/message
// state, cleared whenever the round, turn, or phase changes; the player pop-up composable manages its own state.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import { ordinalText } from '../../../src/messageText.js';
import { COLOURS, COLUMN_BONUS, ROW_BONUS, SET_BONUS, floorPenaltyAfter, lineProblem, previewTake } from '../rules.js';
import Board from './Board.vue';
import { boardCell, plateLayout } from './layout.js';
import Tile from './Tile.vue';
import TilingSummary from './TilingSummary.vue';
import Workshop from './Workshop.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t, text, error, list } = useGameText();

// The end-of-game bonuses, for the final table's headings.
const bonusPoints = { rows: ROW_BONUS, columns: COLUMN_BONUS, sets: SET_BONUS };
// Shorthand for the view, so templates and helpers stay short.
const s = computed(() => props.state);
// True once the game is over.
const finished = computed(() => s.value.phase === 'finished');
// True when the free-wall variant is on.
const free = computed(() => s.value.settings.freeWall);
// The viewer's own seat record, or null for a spectator.
const me = computed(() => s.value.seats[s.value.you] ?? null);
// Returns the display name of a seat, or the site's "Someone" if it is empty.
const nameOf = (seat) => s.value.seats[seat]?.name ?? t('common.someone');
// The name of a tile colour.
const colourName = (colour) => t(`colour.${colour}`);
// True when it is the viewer's turn to take tiles.
const myTurn = computed(() => s.value.phase === 'playing' && s.value.turn === s.value.you);
// True when the viewer is the host (may remove players and restart).
const isHost = computed(() => s.value.hostSeat === s.value.you);

const sel = ref(null); // the chosen colour group: { source: number | 'centre', colour }
const hover = ref(null); // a line index or 'floor' under the pointer
const message = ref('');

// Choices do not survive the turn moving on (a stale selection could otherwise be sent against a changed table).
watch(
  () => `${s.value.round}:${s.value.turn}:${s.value.phase}`,
  () => {
    sel.value = null;
    hover.value = null;
    message.value = '';
  },
);

// ---- the chosen group, and what each line would do with it ----
// Returns the tile array for a plate index or 'centre'.
const sourceTiles = (source) => (source === 'centre' ? s.value.centre : (s.value.factories[source] ?? []));
// Returns a readable name for a tile source, for the status lines.
const sourceName = (source) => (source === 'centre' ? t('source.centre') : t('source.factory', { n: source + 1 }));
// How many tiles are in the selected group (0 if nothing is selected).
const selCount = computed(() => (sel.value ? sourceTiles(sel.value.source).filter((c) => c === sel.value.colour).length : 0));
// True if taking the selected group also takes the first-player marker (taking from the centre first).
const takesMarker = computed(() => Boolean(sel.value) && sel.value.source === 'centre' && s.value.markerInCentre);

/**
 * Explains in words what placing the selected group on a line (or the floor) would do, using the shared rules preview.
 * Each part is a whole sentence of its own, so a translator may reorder the words inside it.
 * @param {number|string} line  Line index 0-4, or 'floor'.
 * @returns {string} The sentences for tooltips and the status box.
 * Side effects: none.
 */
function describe(line) {
  const preview = previewTake({ lines: me.value.lines, floor: me.value.floor }, { count: selCount.value, line, marker: takesMarker.value });
  const colour = colourName(sel.value.colour);
  const parts = [];
  if (line === 'floor') parts.push(t('preview.floor', { count: selCount.value, colour }));
  else {
    parts.push(t(preview.completes ? 'preview.lineComplete' : 'preview.line', { put: preview.put, count: selCount.value, colour, line: line + 1 }));
    if (preview.overflow) parts.push(t('preview.spill', { count: preview.overflow }, preview.overflow));
  }
  if (takesMarker.value) parts.push(t('preview.marker'));
  const cost = preview.extraPenalty;
  parts.push(cost ? t('preview.cost', { cost, total: floorPenaltyAfter(me.value.floor.length, preview) }) : t('preview.noCost'));
  return parts.join(' ');
}

// Per-line { ok, title } hints for the selected group: title is the reason it is refused, or what it would do.  Null when not choosing.
const lineHints = computed(() => {
  if (!sel.value || !myTurn.value || !me.value) return null;
  return Array.from({ length: 5 }, (_, i) => {
    const problem = lineProblem(me.value.lines, me.value.wall, i, sel.value.colour, free.value);
    return { ok: problem === null, title: problem ? text(problem) : describe(i) };
  });
});
// True when the floor line can be clicked (a group is selected on the viewer's turn).
const floorOpen = computed(() => Boolean(sel.value) && myTurn.value);
// The tooltip text for the line or floor being pointed at, or '' when none.
const preview = computed(() => {
  if (!sel.value || !myTurn.value || hover.value === null) return '';
  if (hover.value === 'floor') return describe('floor');
  return lineHints.value?.[hover.value]?.title ?? '';
});

/**
 * Selects a colour group, or deselects it when the same group is clicked again.
 * @param {{source: number|string, colour: number}} group  Plate index or 'centre', and tile colour.
 * @returns {void}
 * Side effects: sets `sel` and clears the message.
 */
function pick({ source, colour }) {
  message.value = '';
  sel.value = sel.value?.source === source && sel.value.colour === colour ? null : { source, colour };
}

/**
 * Sends the selected group to a line (or the floor); on success clears the selection, otherwise shows the server's reason.
 * @param {number|string} line  Line index 0-4, or 'floor'.
 * @returns {Promise<void>}
 * Side effects: sends a `move` request; updates `sel`, `hover`, and `message`.
 */
async function place(line) {
  if (!sel.value) return;
  const reply = await props.send('move', { source: sel.value.source, colour: sel.value.colour, line });
  if (reply.ok) {
    sel.value = null;
    hover.value = null;
    message.value = '';
  } else message.value = error(reply);
}
/**
 * Handles a click on a pattern line: places the group if allowed, else shows why not.
 * @param {number} i  Line index 0-4.
 * @returns {void}
 * Side effects: may call `place` (a server request) or set `message`.
 */
function clickLine(i) {
  if (!lineHints.value) return;
  if (!lineHints.value[i].ok) {
    message.value = lineHints.value[i].title;
    return;
  }
  place(i);
}
// Sends the free-wall column choice and returns the request's promise.
const chooseColumn = (col) => props.send('column', { col });

// ---- the words above the table ----
// Seats that still have to choose a wall column.
const choosing = computed(() => s.value.choosing ?? []);
// The headline of the Status box: what is happening and what the viewer should do.
const status = computed(() => {
  if (finished.value) return t('status.gameOver');
  if (s.value.phase === 'tiling') {
    if (s.value.choice) return t('status.chooseColumn', { colour: colourName(s.value.choice.colour), row: s.value.choice.row + 1 });
    return t('status.waitingColumns', { names: list(choosing.value.map(nameOf)) });
  }
  if (!myTurn.value) return t('status.waitingFor', { name: nameOf(s.value.turn) });
  if (!sel.value) return t('status.yourTurn');
  return t('status.chooseWhere', { count: selCount.value, colour: colourName(sel.value.colour) });
});
// The further lines of the Status box, most useful first.
// (Returns the list of detail lines: strings or { text, tone }.)
const statusLines = computed(() => {
  const lines = [];
  if (sel.value) lines.push({ text: selectedLine.value, tone: 'mine' });
  if (choose.value) lines.push({ text: t('status.clickPlace', { row: choose.value.row + 1 }), tone: 'mine' });
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  else if (preview.value) lines.push(preview.value);
  else if (sel.value && myTurn.value) lines.push({ text: t('status.pointAtLine'), tone: 'muted' });
  else if (myTurn.value && !choose.value) lines.push({ text: t('status.takeTiles'), tone: 'muted' });
  lines.push({ text: t('status.firstPlayer', { name: nameOf(s.value.first), marker: marker.value }), tone: 'muted' });
  return lines;
});
// Describes the current selection in a sentence ('' when nothing is selected).
const selectedLine = computed(() => {
  if (!sel.value) return '';
  const params = { count: selCount.value, colour: colourName(sel.value.colour), source: sourceName(sel.value.source) };
  return t(takesMarker.value ? 'status.selectedMarker' : 'status.selected', params);
});
// Says where the first-player marker is now: in the centre, taken, or with a named player.
const marker = computed(() => {
  const seat = s.value.seats.findIndex((x) => x && x.floor.includes(-1));
  if (s.value.markerInCentre) return t('marker.centre');
  return seat === -1 ? t('marker.taken') : t('marker.with', { name: nameOf(seat) });
});
// Seat index holding the marker on their floor, or -1.
const markerHolder = computed(() => s.value.seats.findIndex((x) => x && x.floor.includes(-1)));

// ---- boards ----
// The pending wall-column choice ({ row, colour, columns }) for the viewer, or null.
const choose = computed(() => (s.value.phase === 'tiling' ? s.value.choice : null));

// ---- fitting the room: everything is sized from the area the frame gives the table ----
// Returns all the sizes derived from the frame's area: board cell, plate size, centre height, and the pop-up board cell.
// Pure: it only reads the area and the number of plates.
const dims = (area) => {
  const { left, right } = area; // the frame's two columns, shared with the bars and the boxes below
  const cell = boardCell(left, area.height, { max: 92 });
  const rightHeight = area.height;
  const centreHeight = Math.max(64, Math.min(150, Math.floor(rightHeight * 0.26)));
  const { diameter } = plateLayout(s.value.factories.length, right, rightHeight - centreHeight - 8, { gap: 10, max: 190 });
  const popup = boardCell(Math.min(560, area.width * 0.5), area.height * 0.72, { max: 36 });
  return { left, right, cell, centreHeight, plate: diameter / 2.35, popup };
};

// Another player's board stays hidden until you click their chip in the score bar: the standard player pop-up (one at
// a time, over the main area, so nothing moves), which also has the host's Remove button.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostSeat,
  isHost: () => isHost.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
// The seat whose board the open pop-up shows, or null.
const openedBoard = computed(() => (openId.value === null ? null : (s.value.seats.find((o) => o && o.seat === openId.value) ?? null))); // yours too: your own summary

// ---- end ----
// Names of the winners (several when shared).
const winners = computed(() => (s.value.winners ?? []).map(nameOf));
// Returns the label for a final placement (the winner, or the place as the language writes it: "2nd").
const rankText = (row) => (row.placement === 1 ? t('table.winnerPlace') : ordinalText(row.placement));
// Total tiles in the box lid (discarded tiles), shown in the status facts.
const lidTotal = computed(() => s.value.lid.reduce((a, b) => a + b, 0));
</script>

<template>
  <GameFrame class="table-view">
    <template #scorebar>
      <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished" :sticky="false" v-bind="scoreProps" running>
        <template #round>
          <TilingSummary v-if="state.lastTiling" :tiling="state.lastTiling" :seats="state.seats" :you="state.you" />
          <p v-if="finished" class="note">{{ t('table.bonusNote') }}</p>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <div class="arena">
        <PlayerPopup v-if="popupProps" v-bind="popupProps">
          <Board v-if="openedBoard" :seat="openedBoard" :cell="dims(area).popup" :free="free" :current="state.phase === 'playing' && state.turn === openedBoard.seat" :next-first="markerHolder === openedBoard.seat" />
        </PlayerPopup>
        <div class="mine-col" :style="{ gridColumn: `span ${area.mainSpan}` }">
          <Board
            v-if="me"
            :seat="me"
            :cell="dims(area).cell"
            is-me
            :free="free"
            :current="myTurn"
            :next-first="markerHolder === state.you"
            :line-hints="lineHints"
            :floor-open="floorOpen"
            :floor-title="t('table.floorTitle')"
            :choose="choose"
            :highlight-row="choose ? choose.row : -1"
            :preview-line="hover"
            @line="clickLine"
            @floor="place('floor')"
            @column="chooseColumn"
            @hover="(v) => (hover = v)"
          />
        </div>

        <div class="right-col" :style="{ gridColumn: `span ${area.columns - area.mainSpan}` }">
          <section v-if="!finished" class="workshop-panel">
            <Workshop :factories="state.factories" :centre="state.centre" :marker-in-centre="state.markerInCentre" :selected="sel" :active="myTurn" :plate="dims(area).plate" :centre-height="dims(area).centreHeight" @pick="pick" />
          </section>

          <section v-else-if="state.final" class="panel final">
            <h3>{{ t('table.finalResult') }}</h3>
            <p class="winner">{{ t('table.winner', { names: list(winners), points: state.final.players[state.winners[0]].total }, winners.length) }}</p>
            <table class="breakdown">
              <thead>
                <tr>
                  <th scope="col">{{ t('table.player') }}</th>
                  <th scope="col">{{ t('table.beforeBonuses') }}</th>
                  <th scope="col">{{ t('table.rows', { bonus: bonusPoints.rows }) }}</th>
                  <th scope="col">{{ t('table.columns', { bonus: bonusPoints.columns }) }}</th>
                  <th scope="col">{{ t('table.colours', { bonus: bonusPoints.sets }) }}</th>
                  <th scope="col">{{ t('table.bonuses') }}</th>
                  <th scope="col">{{ t('scoreboard.total') }}</th>
                  <th scope="col">{{ t('table.place') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in state.final.players" :key="row.seat" :class="{ win: state.winners.includes(row.seat), me: row.seat === state.you }">
                  <th scope="row">{{ row.name }}</th>
                  <td>{{ row.before }}</td>
                  <td>{{ row.rows }}</td>
                  <td>{{ row.columns }}</td>
                  <td>{{ row.sets }}</td>
                  <td>+{{ row.bonus }}</td>
                  <td>
                    <strong>{{ row.total }}</strong>
                  </td>
                  <td>{{ rankText(row) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted small">{{ t('table.tiesNote') }}</p>
            <div class="row">
              <button v-if="isHost" class="primary" @click="send('again')">{{ t('table.playAgain') }}</button>
              <span v-else class="muted">{{ t('table.waitingHost') }}</span>
            </div>
          </section>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="s.log" newest-first :fresh="4" :empty="t('table.nothingPlayed')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="(myTurn && !finished) || Boolean(choose)" :lines="statusLines">
        <template #facts>
          <strong>{{ t('facts.round', { n: state.round }) }}</strong>
          <span>{{ t('facts.inBag', { count: state.bagCount }) }}</span>
          <span class="lid" :title="t('facts.lidTitle', { count: lidTotal }, lidTotal)">
            {{ t('facts.lid') }}
            <span v-for="c in COLOURS" :key="c" class="lid-count"><Tile :colour="c" :size="16" />{{ state.lid[c] }}</span>
          </span>
          <span v-if="free" class="tag free-note">{{ t('freeWall') }}</span>
        </template>
        <div v-if="sel" class="row"><button class="quiet" @click="sel = null">{{ t('table.chooseAnother') }}</button></div>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  position: relative;
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  min-height: 0;
}
.mine-col {
  min-width: 0;
  min-height: 0;
  display: flex;
}
/* Your board fills its column edge to edge and down to the bottom of the main area. */
.mine-col :deep(.board) {
  width: 100%;
  height: 100%;
}
.mine-col :deep(.grid) {
  justify-content: center;
}
.mine-col :deep(.floor) {
  margin-top: auto;
}
.right-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lid {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.lid-count {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  color: var(--parchment);
  font-variant-numeric: tabular-nums;
}
.tag {
  font-size: 0.72rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.free-note {
  border-color: var(--amber);
  color: var(--amber);
}
.workshop-panel {
  flex: 1;
  min-height: 0;
}


.final {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.final .winner {
  margin: 0;
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
}
.small {
  font-size: 0.85rem;
  margin: 0;
}
.breakdown {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}
.breakdown th,
.breakdown td {
  padding: 0.3rem 0.5rem;
  text-align: right;
  border-bottom: 1px solid var(--line);
}
.breakdown th:first-child {
  text-align: left;
}
.breakdown thead th {
  color: var(--muted);
  font-weight: 500;
  font-size: 0.8rem;
}
.breakdown tr.win {
  background: rgb(224 168 74 / 0.12);
}
.breakdown tr.me th {
  color: var(--amber);
}
.note {
  margin: 0.5rem 0 0;
  color: var(--muted);
}
</style>
