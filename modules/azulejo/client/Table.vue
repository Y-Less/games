<script setup>
// The Azulejo table: the display plates and the centre, your board (prominent) and everyone else's beside it, the
// scoreboard, a log, the wall-tiling summary and the final breakdown. The server sends the view; every action is one
// request: `move` (take a colour group and place it) or `column` (free wall only).
import { computed, ref, watch } from 'vue';
import GameLog from '../../../src/components/GameLog.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { COLOUR_NAMES, COLOURS, floorPenalty, lineProblem, previewTake } from '../rules.js';
import Board from './Board.vue';
import Tile from './Tile.vue';
import TilingSummary from './TilingSummary.vue';
import Workshop from './Workshop.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const s = computed(() => props.state);
const finished = computed(() => s.value.phase === 'finished');
const free = computed(() => s.value.settings.freeWall);
const me = computed(() => s.value.seats[s.value.you] ?? null);
const nameOf = (seat) => s.value.seats[seat]?.name ?? 'Someone';
const myTurn = computed(() => s.value.phase === 'playing' && s.value.turn === s.value.you);
const isHost = computed(() => s.value.hostSeat === s.value.you);

const sel = ref(null); // the chosen colour group: { source: number | 'centre', colour }
const hover = ref(null); // a line index or 'floor' under the pointer
const message = ref('');

// Choices do not survive the turn moving on.
watch(
  () => `${s.value.round}:${s.value.turn}:${s.value.phase}`,
  () => {
    sel.value = null;
    hover.value = null;
    message.value = '';
  },
);

// ---- the chosen group, and what each line would do with it ----
const sourceTiles = (source) => (source === 'centre' ? s.value.centre : (s.value.factories[source] ?? []));
const sourceName = (source) => (source === 'centre' ? 'the centre' : `factory ${source + 1}`);
const selCount = computed(() => (sel.value ? sourceTiles(sel.value.source).filter((c) => c === sel.value.colour).length : 0));
const takesMarker = computed(() => Boolean(sel.value) && sel.value.source === 'centre' && s.value.markerInCentre);

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
  parts.push(cost ? `the floor will cost you ${cost} more (${floorPenalty({ length: Math.min(7, me.value.floor.length + preview.onFloor + (preview.markerOnFloor ? 1 : 0)) })} in all)` : 'no new floor penalty');
  return `${parts.join('; ')}.`;
}

const lineHints = computed(() => {
  if (!sel.value || !myTurn.value || !me.value) return null;
  return Array.from({ length: 5 }, (_, i) => {
    const problem = lineProblem(me.value.lines, me.value.wall, i, sel.value.colour, free.value);
    return { ok: problem === null, title: problem ?? describe(i) };
  });
});
const floorOpen = computed(() => Boolean(sel.value) && myTurn.value);
const preview = computed(() => {
  if (!sel.value || !myTurn.value || hover.value === null) return '';
  if (hover.value === 'floor') return describe('floor');
  return lineHints.value?.[hover.value]?.title ?? '';
});

function pick({ source, colour }) {
  message.value = '';
  sel.value = sel.value?.source === source && sel.value.colour === colour ? null : { source, colour };
}

async function place(line) {
  if (!sel.value) return;
  const reply = await props.send('move', { source: sel.value.source, colour: sel.value.colour, line });
  if (reply.ok) {
    sel.value = null;
    hover.value = null;
    message.value = '';
  } else message.value = reply.error ?? '';
}
function clickLine(i) {
  if (!lineHints.value) return;
  if (!lineHints.value[i].ok) {
    message.value = lineHints.value[i].title;
    return;
  }
  place(i);
}
const chooseColumn = (col) => props.send('column', { col });

// ---- the words above the table ----
const choosing = computed(() => s.value.choosing ?? []);
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
const selectedLine = computed(() => {
  if (!sel.value) return '';
  return `${selCount.value} ${COLOUR_NAMES[sel.value.colour]} from ${sourceName(sel.value.source)}${takesMarker.value ? ', with the first-player marker (it takes a floor slot and makes you first next round)' : ''}.`;
});
const marker = computed(() => {
  const seat = s.value.seats.findIndex((x) => x && x.floor.includes(-1));
  if (s.value.markerInCentre) return 'in the centre';
  return seat === -1 ? 'taken' : `with ${nameOf(seat)}`;
});
const markerHolder = computed(() => s.value.seats.findIndex((x) => x && x.floor.includes(-1)));

// ---- boards ----
const others = computed(() => {
  const n = s.value.size;
  const out = [];
  for (let k = 1; k < n; k++) out.push(s.value.seats[(s.value.you + k) % n]);
  return out.filter(Boolean);
});
const otherCell = computed(() => ({ 1: 34, 2: 30, 3: 25, 4: 21 })[others.value.length] ?? 21);
const plate = computed(() => (s.value.factories.length > 9 ? 36 : s.value.factories.length > 7 ? 38 : 42));
const choose = computed(() => (s.value.phase === 'tiling' ? s.value.choice : null));

// ---- end ----
const winners = computed(() => (s.value.winners ?? []).map(nameOf));
const rankText = (row) => (row.placement === 1 ? 'Winner' : ['', '1st', '2nd', '3rd', '4th', '5th'][row.placement] ?? `${row.placement}th`);
const lidTotal = computed(() => s.value.lid.reduce((a, b) => a + b, 0));
</script>

<template>
  <div class="table-view stack">
    <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished">
      <template #round>
        <TilingSummary v-if="state.lastTiling" :tiling="state.lastTiling" :seats="state.seats" :you="state.you" />
        <p v-if="finished" class="note">The last row adds the end-of-game bonuses, so each total equals the final score.</p>
      </template>
    </ScoreBoard>

    <section class="panel info">
      <div class="row head">
        <strong>Round {{ state.round }}</strong>
        <span class="muted">{{ state.bagCount }} in the bag</span>
        <span class="muted lid" :title="`${lidTotal} tiles in the lid`">
          Lid:
          <span v-for="c in COLOURS" :key="c" class="lid-count"><Tile :colour="c" :size="16" />{{ state.lid[c] }}</span>
        </span>
        <span class="muted">First player: {{ nameOf(state.first) }}</span>
        <span class="muted">Marker: {{ marker }}</span>
        <span v-if="free" class="tag">Free wall</span>
      </div>
      <p class="status" :class="{ mine: (myTurn && !finished) || Boolean(choose) }" role="status">{{ status }}</p>
    </section>

    <section v-if="!finished" class="panel workshop-panel">
      <Workshop :factories="state.factories" :centre="state.centre" :marker-in-centre="state.markerInCentre" :selected="sel" :active="myTurn" :plate="plate" @pick="pick" />
    </section>

    <section v-if="finished && state.final" class="panel stack final">
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
        <span v-else class="muted">Waiting for the host to play again, or leave.</span>
        <button class="quiet" @click="send('leave')">Leave game</button>
      </div>
    </section>

    <div class="mine-row">
      <Board
        v-if="me"
        :seat="me"
        :cell="46"
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
      <aside class="side stack">
        <section class="panel stack move" aria-label="Your move">
          <h3>Your move</h3>
          <p v-if="sel" class="chosen">
            <Tile :colour="sel.colour" :size="30" />
            <span>{{ selectedLine }}</span>
          </p>
          <p v-else class="muted">{{ myTurn ? 'Take every tile of one colour from one plate, or from the centre.' : 'Waiting for your turn.' }}</p>
          <p v-if="preview" class="preview" role="status">{{ preview }}</p>
          <p v-else-if="sel && myTurn" class="muted small">Point at a line to see what would happen. Green lines are allowed; the floor always is.</p>
          <p v-if="message" class="reason" role="alert">{{ message }}</p>
          <div v-if="sel" class="row"><button class="quiet" @click="sel = null">Choose another colour</button></div>
          <p v-if="choose" class="chosen">
            <Tile :colour="choose.colour" :size="30" />
            <span>Click one of the highlighted places in row {{ choose.row + 1 }} of your wall.</span>
          </p>
        </section>
        <TilingSummary v-if="state.lastTiling && !finished" class="panel" :tiling="state.lastTiling" :seats="state.seats" :you="state.you" />
      </aside>
    </div>

    <div class="others" :class="`n${others.length}`">
      <Board
        v-for="seat in others"
        :key="seat.seat"
        :seat="seat"
        :cell="otherCell"
        :free="free"
        :current="state.phase === 'playing' && state.turn === seat.seat"
        :next-first="markerHolder === seat.seat"
      />
    </div>

    <section class="panel log">
      <h3>Recent play</h3>
      <GameLog class="recent" :entries="s.log" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry.text }}</GameLog>
    </section>

    <p v-if="!finished" class="row foot"><button class="quiet" @click="send('leave')">Leave game</button><span class="muted small">A computer player takes your seat if you leave.</span></p>
  </div>
</template>

<style scoped>
.info {
  padding: 0.55rem 0.9rem;
}
.head {
  gap: 0.4rem 1.1rem;
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
  font-size: 0.75rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--amber);
  color: var(--amber);
}
.status {
  margin: 0.3rem 0 0;
  color: var(--muted);
}
.status.mine {
  color: var(--amber);
  font-weight: 600;
}
.workshop-panel {
  padding: 0.7rem 0.9rem;
}
.mine-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  min-height: 17rem;
}
.side {
  min-width: 0;
  /* As tall as the board beside it, whatever the move panel and the tiling summary say: they scroll instead of growing the page. */
  align-self: stretch;
  contain: size;
  overflow-y: auto;
}
.move h3,
.log h3 {
  font-size: 1rem;
  color: var(--amber);
}
.chosen {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0;
}
.preview {
  margin: 0;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  background: rgb(127 174 122 / 0.15);
  border: 1px solid var(--moss);
}
.reason {
  margin: 0;
  color: var(--danger);
}
.small {
  font-size: 0.85rem;
  margin: 0;
}
.log .recent {
  --log-height: 8rem;
  margin-top: 0.3rem;
  font-size: 0.85rem;
  gap: 0.1rem;
}
.others {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
}
.others.n1 {
  grid-template-columns: minmax(0, 28rem);
}
.others.n2 {
  grid-template-columns: repeat(2, minmax(0, 24rem));
}
.final .winner {
  margin: 0;
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
}
.breakdown {
  border-collapse: collapse;
  width: 100%;
  font-variant-numeric: tabular-nums;
}
.breakdown th,
.breakdown td {
  padding: 0.35rem 0.6rem;
  text-align: right;
  border-bottom: 1px solid var(--line);
}
.breakdown th:first-child {
  text-align: left;
}
.breakdown thead th {
  color: var(--muted);
  font-weight: 500;
  font-size: 0.85rem;
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
.foot {
  justify-content: flex-start;
}
</style>
