<script setup>
// The Azulejo table: the display plates and the centre, your board (prominent) and everyone else's beside it, the
// scoreboard, a log, the wall-tiling summary and the final breakdown. The server sends the view; every action is one
// request: `move` (take a colour group and place it) or `column` (free wall only).
//
// Props:
//   state  {Object}    required. The player's view of the game (phases playing, tiling, finished).
//   send   {Function}  required. send(action, payload) returns a promise of { ok, error? } from the server.
// Emits: none.
// Slots: none (fills GameFrame's scorebar, main, log and status slots).
// Side effects: sends `move`, `column`, `again`, `kick` and `removeBot` requests; keeps local selection/hover/message
// state, cleared whenever the round, turn or phase changes; the player pop-up composable manages its own state.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { COLOUR_NAMES, COLOURS, floorPenaltyAfter, lineProblem, previewTake } from '../rules.js';
import Board from './Board.vue';
import { boardCell, plateLayout } from './layout.js';
import Tile from './Tile.vue';
import TilingSummary from './TilingSummary.vue';
import Workshop from './Workshop.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

// Shorthand for the view, so templates and helpers stay short.
const s = computed(() => props.state);
// True once the game is over.
const finished = computed(() => s.value.phase === 'finished');
// True when the free-wall variant is on.
const free = computed(() => s.value.settings.freeWall);
// The viewer's own seat record, or null for a spectator.
const me = computed(() => s.value.seats[s.value.you] ?? null);
// Returns the display name of a seat, or 'Someone' if it is empty.
const nameOf = (seat) => s.value.seats[seat]?.name ?? 'Someone';
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
// Returns a readable name for a tile source, for messages.
const sourceName = (source) => (source === 'centre' ? 'the centre' : `factory ${source + 1}`);
// How many tiles are in the selected group (0 if nothing is selected).
const selCount = computed(() => (sel.value ? sourceTiles(sel.value.source).filter((c) => c === sel.value.colour).length : 0));
// True if taking the selected group also takes the first-player marker (taking from the centre first).
const takesMarker = computed(() => Boolean(sel.value) && sel.value.source === 'centre' && s.value.markerInCentre);

/**
 * Explains in words what placing the selected group on a line (or the floor) would do, using the shared rules preview.
 * @param {number|string} line  Line index 0-4, or 'floor'.
 * @returns {string} A sentence for tooltips and the status box.
 * Side effects: none.
 */
function describe(line) {
  const preview = previewTake({ lines: me.value.lines, floor: me.value.floor }, { count: selCount.value, line, marker: takesMarker.value });
  const name = COLOUR_NAMES[sel.value.colour];
  const parts = [];
  if (line === 'floor') parts.push(`All ${selCount.value} ${name} go to the floor`);
  else {
    parts.push(`${preview.put} of ${selCount.value} ${name} go on line ${line + 1}${preview.completes ? ', completing it' : ''}`);
    if (preview.overflow) parts.push(`${preview.overflow} spill to the floor`);
  }
  if (takesMarker.value) parts.push('you also take the first-player marker');
  const cost = preview.extraPenalty;
  parts.push(cost ? `the floor will cost you ${cost} more (${floorPenaltyAfter(me.value.floor.length, preview)} in all)` : 'no new floor penalty');
  return `${parts.join('; ')}.`;
}

// Per-line { ok, title } hints for the selected group: title is the reason it is refused, or what it would do. Null when not choosing.
const lineHints = computed(() => {
  if (!sel.value || !myTurn.value || !me.value) return null;
  return Array.from({ length: 5 }, (_, i) => {
    const problem = lineProblem(me.value.lines, me.value.wall, i, sel.value.colour, free.value);
    return { ok: problem === null, title: problem ?? describe(i) };
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
 * Side effects: sends a `move` request; updates `sel`, `hover` and `message`.
 */
async function place(line) {
  if (!sel.value) return;
  const reply = await props.send('move', { source: sel.value.source, colour: sel.value.colour, line });
  if (reply.ok) {
    sel.value = null;
    hover.value = null;
    message.value = '';
  } else message.value = reply.error ?? '';
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
  if (finished.value) return 'The game is over.';
  if (s.value.phase === 'tiling') {
    if (s.value.choice) return `Wall-tiling: choose the column for your ${COLOUR_NAMES[s.value.choice.colour]} tile in row ${s.value.choice.row + 1}.`;
    return `Wall-tiling: waiting for ${choosing.value.map(nameOf).join(', ')} to choose a column…`;
  }
  if (!myTurn.value) return `Waiting for ${nameOf(s.value.turn)}…`;
  if (!sel.value) return 'Your turn: click a colour on a plate or in the centre.';
  return `Now choose where the ${selCount.value} ${COLOUR_NAMES[sel.value.colour]} go: a highlighted line, or the floor.`;
});
// The further lines of the Status box, most useful first.
// (Returns the list of detail lines: strings or { text, tone }.)
const statusLines = computed(() => {
  const lines = [];
  if (sel.value) lines.push({ text: selectedLine.value, tone: 'mine' });
  if (choose.value) lines.push({ text: `Click one of the highlighted places in row ${choose.value.row + 1} of your wall.`, tone: 'mine' });
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  else if (preview.value) lines.push(preview.value);
  else if (sel.value && myTurn.value) lines.push({ text: 'Point at a line to see what would happen. Green lines are allowed; the floor always is.', tone: 'muted' });
  else if (myTurn.value && !choose.value) lines.push({ text: 'Take every tile of one colour from one plate, or from the centre.', tone: 'muted' });
  lines.push({ text: `First player: ${nameOf(s.value.first)}. First-player marker: ${marker.value}.`, tone: 'muted' });
  return lines;
});
// Describes the current selection in a sentence ('' when nothing is selected).
const selectedLine = computed(() => {
  if (!sel.value) return '';
  return `${selCount.value} ${COLOUR_NAMES[sel.value.colour]} from ${sourceName(sel.value.source)}${takesMarker.value ? ', with the first-player marker (it takes a floor slot and makes you first next round)' : ''}.`;
});
// Says where the first-player marker is now: in the centre, taken, or with a named player.
const marker = computed(() => {
  const seat = s.value.seats.findIndex((x) => x && x.floor.includes(-1));
  if (s.value.markerInCentre) return 'in the centre';
  return seat === -1 ? 'taken' : `with ${nameOf(seat)}`;
});
// Seat index holding the marker on their floor, or -1.
const markerHolder = computed(() => s.value.seats.findIndex((x) => x && x.floor.includes(-1)));

// ---- boards ----
// The pending wall-column choice ({ row, colour, columns }) for the viewer, or null.
const choose = computed(() => (s.value.phase === 'tiling' ? s.value.choice : null));

// ---- fitting the room: everything is sized from the area the frame gives the table ----
// Returns all the sizes derived from the frame's area: board cell, plate size, centre height and the pop-up board cell.
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
// Returns the label for a final placement ('Winner', '2nd', ...).
const rankText = (row) => (row.placement === 1 ? 'Winner' : ['', '1st', '2nd', '3rd', '4th', '5th'][row.placement] ?? `${row.placement}th`);
// Total tiles in the box lid (discarded tiles), shown in the status facts.
const lidTotal = computed(() => s.value.lid.reduce((a, b) => a + b, 0));
</script>

<template>
  <GameFrame class="table-view">
    <template #scorebar>
      <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished" :sticky="false" v-bind="scoreProps" running>
        <template #round>
          <TilingSummary v-if="state.lastTiling" :tiling="state.lastTiling" :seats="state.seats" :you="state.you" />
          <p v-if="finished" class="note">The last row adds the end-of-game bonuses, so each total equals the final score.</p>
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
            floor-title="Put them all on the floor line"
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
            <h3>Final result</h3>
            <p class="winner">{{ winners.join(' and ') }} {{ winners.length > 1 ? 'share the win' : 'wins' }} with {{ state.final.players[state.winners[0]].total }} points.</p>
            <table class="breakdown">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Before bonuses</th>
                  <th scope="col">Rows (+2)</th>
                  <th scope="col">Columns (+7)</th>
                  <th scope="col">Colours (+10)</th>
                  <th scope="col">Bonuses</th>
                  <th scope="col">Total</th>
                  <th scope="col">Place</th>
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
            <p class="muted small">Ties are broken by the most complete rows; if still tied, the win is shared.</p>
            <div class="row">
              <button v-if="isHost" class="primary" @click="send('again')">Play again</button>
              <span v-else class="muted">Waiting for the host to play again, or leave (top right).</span>
            </div>
          </section>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="s.log" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry.text }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="(myTurn && !finished) || Boolean(choose)" :lines="statusLines">
        <template #facts>
          <strong>Round {{ state.round }}</strong>
          <span>{{ state.bagCount }} in the bag</span>
          <span class="lid" :title="`${lidTotal} tiles in the lid`">
            Lid:
            <span v-for="c in COLOURS" :key="c" class="lid-count"><Tile :colour="c" :size="16" />{{ state.lid[c] }}</span>
          </span>
          <span v-if="free" class="tag free-note">Free wall</span>
        </template>
        <div v-if="sel" class="row"><button class="quiet" @click="sel = null">Choose another colour</button></div>
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
