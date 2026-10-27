<script setup>
// The play field, in the standard frame: the score bar on top; the table of sets (wide) with your rack, the New set
// area and the turn buttons directly under it; slim bars for the other players; and the two boxes along the bottom,
// Recent moves and Status. Everything that is said (whose turn it is, the round, the pool, the first-meld target, the
// live check of your layout) is in Status, so nothing in the play area grows, shrinks or moves while the game is played.
// The table is a list of sets; your rack sits below. During your turn you build a working copy of the
// table (move tiles by dragging them, or by clicking tiles and then clicking where they should go) and press End turn,
// which sends the whole layout to the server; the server makes the same check as the buttons here and answers with
// the new state, or refuses and leaves everything as it was. Undo and Reset turn only touch the working copy.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { dealSize } from '../rules.js';
import { canMove, moveTiles, placedThisTurn, sameArrangement, sortRack, startArrangement, turnStatus } from './layout.js';
import RoundSummary from './RoundSummary.vue';
import Tile from './Tile.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const FROZEN = 'Until your first meld the sets already on the table cannot be changed.';

const s = computed(() => props.state.settings);
const finished = computed(() => props.state.phase === 'finished');
const between = computed(() => props.state.phase === 'between');
const me = computed(() => props.state.seats[props.state.you] ?? null);
const myTurn = computed(() => props.state.phase === 'playing' && props.state.turn === props.state.you && props.state.you !== -1);
const melded = computed(() => Boolean(me.value?.melded));
const nameOf = (seat) => props.state.seats[seat]?.name ?? 'Someone';
const isHost = computed(() => props.state.hostSeat === props.state.you);

// ---- the working copy of this turn ----
const arr = ref(startArrangement(props.state.table, props.state.rack));
const undoStack = ref([]);
const selected = ref([]);
const dragging = ref([]);
const hint = ref('');
const sortMode = ref('run');
const busy = ref(false);

function reset() {
  arr.value = startArrangement(props.state.table, props.state.rack);
  undoStack.value = [];
  selected.value = [];
  hint.value = '';
}
watch(() => [props.state.version, props.state.round, props.state.phase, props.state.you], reset);

const status = computed(() =>
  turnStatus(s.value, { arr: arr.value, before: props.state.table, rack: props.state.rack, melded: melded.value, meld: s.value.meld }),
);
const changed = computed(() => !sameArrangement(arr.value, startArrangement(props.state.table, props.state.rack)));
const fresh = computed(() => placedThisTurn(arr.value, props.state.table));
const recent = computed(() => new Set(props.state.lastPlay?.ids ?? []));
const rackTiles = computed(() => sortRack(s.value, arr.value.rack, sortMode.value));
const oldIds = computed(() => new Set(props.state.table.flat()));
const frozenSet = (ids) => !melded.value && ids.some((id) => oldIds.value.has(id));
const lockedTile = (id) => !melded.value && oldIds.value.has(id);

const shownSets = computed(() =>
  arr.value.sets.map((ids, index) => {
    const result = status.value.sets[index];
    const items = result.ok ? result.items : ids.map((id) => ({ id, joker: false }));
    return { index, ids, result, items, frozen: frozenSet(ids) };
  }),
);
const stands = (item) => (item.joker && item.number ? { number: item.number, colour: item.colour } : null);

const canEnd = computed(() => myTurn.value && status.value.ok && !busy.value);
const summary = computed(() => {
  if (!myTurn.value) return '';
  if (!changed.value) {
    return melded.value
      ? 'Move tiles from your rack onto the table, or rearrange it. Or draw a tile.'
      : `Make a first meld of ${s.value.meld} or more points from your own tiles, or draw a tile.`;
  }
  if (status.value.ok) {
    return melded.value
      ? `Ready: ${status.value.placed} ${status.value.placed === 1 ? 'tile' : 'tiles'} played.`
      : `Ready: first meld worth ${status.value.points} points.`;
  }
  return status.value.error;
});

// ---- moving tiles ----
function remember() {
  undoStack.value.push({ arr: arr.value });
}
function place(ids, target) {
  const problem = canMove(arr.value, ids, target, { before: props.state.table, melded: melded.value });
  if (problem) {
    hint.value = problem;
    return false;
  }
  hint.value = '';
  remember();
  arr.value = moveTiles(arr.value, ids, target);
  selected.value = [];
  return true;
}
function pick(id) {
  if (!myTurn.value) return;
  if (lockedTile(id)) {
    hint.value = FROZEN;
    return;
  }
  hint.value = '';
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id];
}
function dropSelected(target) {
  if (myTurn.value && selected.value.length) place([...selected.value], target);
}
function dragStart(event, id) {
  if (!myTurn.value || lockedTile(id)) {
    event.preventDefault();
    return;
  }
  dragging.value = selected.value.includes(id) ? [...selected.value] : [id];
  try {
    event.dataTransfer.setData('text/plain', dragging.value.join(','));
    event.dataTransfer.effectAllowed = 'move';
  } catch {
    // an environment without data transfer (the tests)
  }
}
function drop(target) {
  const ids = dragging.value;
  dragging.value = [];
  if (myTurn.value && ids.length) place(ids, target);
}
const dragEnd = () => {
  dragging.value = [];
};

function undo() {
  const last = undoStack.value.pop();
  if (!last) return;
  arr.value = last.arr;
  selected.value = [];
  hint.value = '';
}

async function endTurn() {
  if (!canEnd.value) return;
  busy.value = true;
  try {
    await props.send('play', { table: arr.value.sets });
  } finally {
    busy.value = false;
  }
}
async function drawTile() {
  if (!myTurn.value || busy.value) return;
  busy.value = true;
  try {
    await props.send('draw');
  } finally {
    busy.value = false;
  }
}
const onContinue = () => {
  if (props.state.phase === 'between') props.send('next');
};

// ---- the turn timer ----
const clock = ref(Date.now());
const deadline = ref(null);
watch(
  () => [props.state.version, props.state.remaining],
  () => {
    deadline.value = props.state.remaining === null || props.state.remaining === undefined ? null : Date.now() + props.state.remaining;
  },
  { immediate: true },
);
const secondsLeft = computed(() => (deadline.value === null ? null : Math.max(0, Math.ceil((deadline.value - clock.value) / 1000))));
let ticker = null;
onMounted(() => {
  ticker = setInterval(() => {
    clock.value = Date.now();
  }, 500);
});
onBeforeUnmount(() => clearInterval(ticker));

const readyNames = computed(() => props.state.seats.filter((x) => x && !x.bot && x.ready).map((x) => x.name));
const waitingNames = computed(() => (between.value ? props.state.seats.filter((x) => x && !x.bot && !x.ready).map((x) => x.name) : []));
const scorePlayers = computed(() => props.state.scoreboard.players.map((p) => ({ ...p, ready: between.value && Boolean(props.state.seats[p.id]?.bot || props.state.seats[p.id]?.ready) })));
const youReady = computed(() => Boolean(me.value?.ready));
const hand = computed(() => dealSize(s.value, props.state.size));
// Another player's details (their tile count and so on) open from their chip in the score bar: one at a time, floating
// over the top of the main area so that nothing moves.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => scorePlayers.value,
  hostId: () => props.state.hostSeat,
  isHost: () => isHost.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
const opened = computed(() => props.state.seats.find((o) => o && o.seat === openId.value) ?? null); // yours too: your own summary
const openedScore = computed(() => props.state.scoreboard.players.find((p) => p.id === openId.value)?.score ?? 0);
const lastLine = computed(() => props.state.log.at(-1)?.text ?? '');
const headline = computed(() => {
  if (finished.value) return props.state.winners.length === 1 ? `${nameOf(props.state.winners[0])} wins the game!` : `${props.state.winners.map(nameOf).join(' and ')} share the win.`;
  if (between.value) return `Round ${props.state.round} is over.`;
  if (props.state.phase !== 'playing') return '';
  return myTurn.value ? 'Your turn' : `${nameOf(props.state.turn)} is playing`;
});
// The live message about your layout (or the last refusal) and, between rounds, who is ready.
const lines = computed(() => {
  if (between.value) {
    return [
      lastLine.value,
      youReady.value ? `Waiting for ${waitingNames.value.join(', ')}` : 'Close the scores to carry on.',
      { text: `Ready: ${readyNames.value.join(', ') || 'nobody yet'}`, tone: 'muted' },
    ].filter(Boolean);
  }
  if (!myTurn.value) return props.state.phase === 'playing' ? [{ text: `Each player started with ${hand.value} tiles.`, tone: 'muted' }] : [];
  const text = hint.value || summary.value;
  const tone = hint.value || (changed.value && !status.value.ok) ? 'warn' : changed.value && status.value.ok ? 'mine' : '';
  return [{ text, tone }];
});
const setLabel = (set) => {
  if (!set.result.ok) return set.result.error;
  return `${set.result.kind === 'run' ? 'Run' : 'Group'}, ${set.result.value}`;
};
// The rack's rows follow the room the frame leaves (a larger window shows more of it), never what is in it.
const rackRows = (area) => (area.height >= 600 ? 3 : 2);
</script>

<template>
  <GameFrame class="table-view" :main-span="9">
    <template #scorebar>
      <ScoreBoard :players="scorePlayers" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished" :awaiting="between && !youReady" :waiting="waitingNames" :sticky="false" v-bind="scoreProps" @continue="onContinue">
        <template #round>
          <RoundSummary v-if="state.lastRound" :last-round="state.lastRound" :seats="state.seats" :settings="s" :you="state.you" />
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <div class="arena" :style="{ '--rack-rows': rackRows(area) }">
        <PlayerPopup v-if="popupProps" v-bind="popupProps">
          <dl v-if="opened" class="facts">
            <dt>Tiles in rack</dt>
            <dd>{{ opened.count }}</dd>
            <dt>First meld</dt>
            <dd>{{ opened.melded ? 'made' : 'not yet' }}</dd>
            <dt>Score</dt>
            <dd>{{ openedScore }}</dd>
            <dt>Turn</dt>
            <dd>{{ state.phase === 'playing' && state.turn === opened.seat ? 'playing now' : 'waiting' }}</dd>
          </dl>
        </PlayerPopup>
        <section class="felt" aria-label="The table">
          <div v-if="!shownSets.length" class="muted empty">The table is empty. {{ myTurn ? 'Make a first set from your rack.' : '' }}</div>
          <div class="sets">
            <div
              v-for="set in shownSets"
              :key="set.ids.join('-')"
              class="set"
              :class="{ bad: !set.result.ok, good: set.result.ok, frozen: set.frozen, target: selected.length && myTurn && !set.frozen }"
              :data-set="set.index"
              @click.self="dropSelected({ type: 'set', index: set.index })"
              @dragover.prevent
              @drop.prevent="drop({ type: 'set', index: set.index })"
            >
              <div class="tiles" @click.self="dropSelected({ type: 'set', index: set.index })">
                <Tile
                  v-for="item in set.items"
                  :key="item.id"
                  :settings="s"
                  :id="item.id"
                  :selected="selected.includes(item.id)"
                  :fresh="fresh.has(item.id)"
                  :recent="recent.has(item.id) && !fresh.has(item.id)"
                  :locked="lockedTile(item.id)"
                  :stands="stands(item)"
                  :interactive="myTurn"
                  @click.stop="pick(item.id)"
                  @dragstart="dragStart($event, item.id)"
                  @dragend="dragEnd"
                />
                <button
                  v-if="myTurn && !set.frozen"
                  class="add"
                  :class="{ ready: selected.length > 0 }"
                  :tabindex="selected.length ? 0 : -1"
                  :aria-hidden="selected.length ? undefined : 'true'"
                  :aria-label="`Add the selected tiles to set ${set.index + 1}`" @click.stop="dropSelected({ type: 'set', index: set.index })">+</button>
              </div>
              <small class="label" :class="{ err: !set.result.ok }">{{ setLabel(set) }}</small>
            </div>
          </div>
        </section>

        <section class="rack-panel" :class="{ mine: myTurn }" aria-label="Your rack" :style="{ gridColumn: `span ${area.mainSpan}` }">
          <div class="rack-head">
            <strong>Your rack<span class="muted"> ({{ arr.rack.length }} {{ arr.rack.length === 1 ? 'tile' : 'tiles' }})</span></strong>
            <div class="seg" role="group" aria-label="Sort the rack">
              <button :class="{ primary: sortMode === 'run' }" :aria-pressed="sortMode === 'run'" title="Colour, then number: good for runs" @click="sortMode = 'run'">Runs</button>
              <button :class="{ primary: sortMode === 'group' }" :aria-pressed="sortMode === 'group'" title="Number, then colour: good for groups" @click="sortMode = 'group'">Groups</button>
            </div>
          </div>
          <div
            class="rack"
            :class="{ target: selected.length && myTurn }"
            data-rack
            @click.self="dropSelected({ type: 'rack' })"
            @dragover.prevent
            @drop.prevent="drop({ type: 'rack' })"
          >
            <Tile
              v-for="id in rackTiles"
              :key="id"
              :settings="s"
              :id="id"
              :selected="selected.includes(id)"
              :interactive="myTurn"
              @click.stop="pick(id)"
              @dragstart="dragStart($event, id)"
              @dragend="dragEnd"
            />
            <span v-if="!rackTiles.length" class="muted">Your rack is empty.</span>
          </div>
        </section>

        <div class="actions">
          <div
            class="set new"
            :class="{ target: selected.length && myTurn, idle: !myTurn }"
            role="button"
            :tabindex="myTurn ? 0 : -1"
            :aria-disabled="myTurn ? undefined : 'true'"
            aria-label="Start a new set"
            @click="dropSelected({ type: 'new' })"
            @keydown.enter.prevent="dropSelected({ type: 'new' })"
            @keydown.space.prevent="dropSelected({ type: 'new' })"
            @dragover.prevent
            @drop.prevent="drop({ type: 'new' })"
          >
            <span class="muted">New set: drop tiles here</span>
          </div>
          <div class="buttons">
            <button :disabled="!myTurn || !undoStack.length" @click="undo">Undo</button>
            <button :disabled="!myTurn || !changed" @click="reset">Reset turn</button>
            <button :disabled="!myTurn || busy" :title="state.poolCount ? 'Take a tile from the pool and end your turn' : 'The pool is empty: pass'" @click="drawTile">
              {{ state.poolCount ? 'Draw a tile' : 'Pass' }}
            </button>
            <button class="primary" :disabled="!canEnd" @click="endTurn">End turn</button>
          </div>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="state.log" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry.text }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="myTurn && !finished" :lines="lines">
        <template #facts>
          <strong>Round {{ state.round }}<template v-if="s.rounds > 1"> of {{ s.rounds }}</template></strong>
          <span class="pool" :title="`${state.poolCount} tiles in the pool`"><span class="back" aria-hidden="true"></span>{{ state.poolCount }} in the pool</span>
          <span>First meld: {{ s.meld }} points<template v-if="!melded && state.you !== -1"> (you have {{ status.points }})</template></span>
          <span v-if="secondsLeft !== null" class="timer" :class="{ low: secondsLeft <= 10 }" aria-label="Time left this turn">{{ secondsLeft }}s left</span>
        </template>
        <div v-if="finished" class="row">
          <button v-if="isHost" class="primary" @click="send('again')">Play again</button>
          <span v-else class="muted">Waiting for the host to play again.</span>
        </div>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
/* No slim bars: the frame has three rows (score bar, table, bottom boxes). */
.game-frame.table-view {
  grid-template-rows: auto minmax(0, 1fr) clamp(6.5rem, 22%, 13rem);
}
.arena {
  grid-column: 1 / -1;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: subgrid;
  grid-template-rows: minmax(0, 1fr) auto;
  row-gap: 8px;
}

/* The table of sets: wide, a fixed height whatever is laid; a long game scrolls inside it. */
.felt {
  grid-column: 1 / -1;
  min-height: 0;
  padding: 0.6rem 0.8rem;
  overflow-y: auto;
  border-radius: var(--radius);
  background: radial-gradient(900px 400px at 50% 0%, #25503f, #173428);
  border: 1px solid #2d5a47;
}
.empty {
  padding: 0.4rem;
}
.sets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  align-items: flex-start;
}
.set {
  display: grid;
  gap: 0.25rem;
  padding: 0.45rem 0.5rem 0.3rem;
  border-radius: 12px;
  background: rgb(0 0 0 / 0.22);
  border: 2px solid transparent;
  max-width: 100%;
}
.set.good {
  border-color: rgb(127 174 122 / 0.45);
}
.set.bad {
  border-color: var(--danger);
}
.set.frozen {
  opacity: 0.85;
  border-style: dashed;
}
.set.target:not(.new) {
  cursor: copy;
}
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}
.label {
  color: var(--muted);
  font-size: 0.78rem;
  max-width: 18rem;
}
.label.err {
  color: #ffb4a3;
}
.add {
  /* always present (so nothing moves when a tile is picked up); only its visibility changes */
  visibility: hidden;
  width: 2.2rem;
  height: 3.2rem;
  padding: 0;
  border-radius: 7px;
  border-style: dashed;
  font-size: 1.3rem;
}
.add.ready {
  visibility: visible;
}

/* Your rack: the most prominent thing, directly under the table, with room for a fixed number of rows of tiles. */
.rack-panel {
  --rows: var(--rack-rows, 2);
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.rack-head {
  height: 1.9rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}
.seg {
  display: inline-flex;
  gap: 0.3rem;
}
.seg button {
  padding-top: 0.15rem;
  padding-bottom: 0.15rem;
}
.rack {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 0.3rem;
  padding: 0.6rem;
  box-sizing: border-box;
  height: calc(var(--rows) * 3.5rem + (var(--rows) - 1) * 0.3rem + 1.4rem);
  overflow-y: auto;
  border-radius: 12px;
  background: linear-gradient(180deg, #5b4527, #46341c);
  border: 1px solid #2c200f;
}
.rack-panel.mine .rack {
  border-color: var(--amber);
}
.rack.target {
  outline: 2px dashed #4aa3ff;
}

/* The New set area and the four turn buttons: always in the same place, beside the rack. */
.actions {
  grid-column: span 3;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: calc(1.9rem + 0.4rem); /* level with the rack, not with its heading */
}
.set.new {
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  text-align: center;
  border: 2px dashed rgb(241 231 210 / 0.4);
  background: none;
  cursor: pointer;
}
.set.new.idle {
  cursor: default;
  opacity: 0.55;
}
.set.new.target {
  border-color: #4aa3ff;
}
.buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.buttons button {
  height: 2.4rem;
  padding: 0 0.5rem;
  white-space: nowrap;
}

/* Another player's details, in the panel of the standard player pop-up (opened from their chip in the score bar). */
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 1rem;
  margin: 0;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Status facts. */
.pool {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.back {
  display: inline-block;
  width: 0.8rem;
  height: 1.05rem;
  border-radius: 3px;
  border: 1px solid #b7a98a;
  background: repeating-linear-gradient(45deg, #6b5a3a, #6b5a3a 3px, #85714a 3px, #85714a 6px);
}
.timer {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--parchment);
}
.timer.low {
  color: var(--danger);
}
</style>
