<script setup>
// The Gaudi table: choosing a window, then the draft pool, your window, the round track, the tool cards, the
// objectives, everybody's windows and the final breakdown. The server sends the view; every action is one request.
import { computed, ref, watch } from 'vue';
import GameLog from '../../../src/components/GameLog.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import Die from './Die.vue';
import WindowGrid from './WindowGrid.vue';
import { COLOUR_HEX, COLOUR_LABEL, SHAPES, SHAPE_OF } from './glyphs.js';
import { startMode } from './toolkit.js';
import { cellProblem, moveProblem } from '../rules.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const board = ref(null);
const selected = ref(null); // the pool die chosen for placing
const mode = ref(null); // a tool being used
const message = ref('');
const picked = ref(null); // the window chosen but not yet confirmed

const s = computed(() => props.state);
const windows = computed(() => s.value.phase === 'windows');
const finished = computed(() => s.value.phase === 'finished');
const me = computed(() => s.value.seats[s.value.you] ?? null);
const nameOf = (seat) => s.value.seats[seat]?.name ?? 'Someone';
const myTurn = computed(() => s.value.phase === 'playing' && s.value.turn?.seat === s.value.you);
const canPlace = computed(() => myTurn.value && s.value.turn.placements < s.value.turn.allowed);
const toolFree = computed(() => myTurn.value && !s.value.turn.toolUsed);
const pattern = computed(() => (me.value?.window ? { cells: me.value.window.rows.join('').split('') } : null));
const myGrid = computed(() => mode.value?.grid ?? me.value?.window?.grid ?? Array(20).fill(null));
const poolDie = (id) => (s.value.pool ?? []).find((d) => d.id === id) ?? null;
const others = computed(() => s.value.seats.filter((seat) => seat && seat.seat !== s.value.you));
const waitingFor = computed(() => s.value.seats.filter((seat) => seat && !seat.picked).map((seat) => seat.name));
const turnNumber = computed(() => (s.value.turn?.number === 2 ? 'second' : 'first'));
const colourName = (c) => COLOUR_LABEL[c] ?? c;

// ---- guided choices reset whenever the turn moves on ----
watch(
  () => `${s.value.round}:${s.value.turnIndex}:${s.value.phase}`,
  () => {
    selected.value = null;
    mode.value = null;
    message.value = '';
  },
);
watch(
  () => (s.value.pool ?? []).map((d) => `${d.id}${d.v}`).join(),
  () => {
    if (selected.value !== null && !poolDie(selected.value)) selected.value = null;
    if (mode.value?.die != null && !poolDie(mode.value.die)) mode.value.die = null;
  },
);

// ---- window choice ----
async function chooseWindow() {
  if (!picked.value) return;
  const reply = await props.send('window', { pid: picked.value });
  if (reply.ok) picked.value = null;
}

// ---- explanations for the spaces ----
const highlight = computed(() => {
  const out = { legal: [], pick: [], chosen: [], titles: {} };
  if (!myTurn.value || !pattern.value) return out;
  const grid = myGrid.value;
  const m = mode.value;
  if (m?.kind === 'moves') {
    if (m.from === null) {
      const colour = m.sameColour && m.moves.length ? grid[m.moves[0].to]?.c : null;
      grid.forEach((d, i) => {
        if (d && !m.moves.some((mv) => mv.to === i) && (!colour || d.c === colour)) out.pick.push(i);
      });
    } else {
      out.chosen.push(m.from);
      for (let i = 0; i < 20; i++) {
        const problem = moveProblem(grid, pattern.value, m.from, i, m.options);
        if (problem === null) out.legal.push(i);
        else out.titles[i] = problem;
      }
    }
    return out;
  }
  const dieId = m?.kind === 'free' ? m.die : m ? null : selected.value;
  const die = dieId == null ? null : poolDie(dieId);
  if (die && (m?.kind === 'free' || canPlace.value)) {
    for (let i = 0; i < 20; i++) {
      const problem = cellProblem(grid, pattern.value, i, die, m?.options ?? {});
      if (problem === null) out.legal.push(i);
      else out.titles[i] = problem;
    }
  }
  return out;
});

// ---- clicking dice and spaces ----
function clickPool(die) {
  message.value = '';
  const m = mode.value;
  if (m) {
    if (['delta', 'pool', 'exchange', 'free'].includes(m.kind)) m.die = m.die === die.id ? null : die.id;
    else message.value = 'This tool does not use a pool die.';
    return;
  }
  if (!myTurn.value) return void (message.value = `It is ${nameOf(s.value.turn?.seat)}'s turn.`);
  if (!canPlace.value) return void (message.value = 'You have already placed a die this turn.');
  selected.value = selected.value === die.id ? null : die.id;
}

function clickTrack(die) {
  if (mode.value?.kind !== 'exchange') return;
  mode.value.trackDie = mode.value.trackDie === die.id ? null : die.id;
}

async function clickCell(index) {
  message.value = '';
  if (!myTurn.value) return void (message.value = `It is ${nameOf(s.value.turn?.seat)}'s turn.`);
  const m = mode.value;
  if (m?.kind === 'moves') return clickMoveCell(m, index);
  const dieId = m?.kind === 'free' ? m.die : m ? null : selected.value;
  if (m && m.kind !== 'free') return void (message.value = m.how);
  const die = dieId == null ? null : poolDie(dieId);
  if (!die) return void (message.value = canPlace.value || m ? 'Choose a die from the pool first.' : 'You have already placed a die this turn.');
  const problem = cellProblem(myGrid.value, pattern.value, index, die, m?.options ?? {});
  if (problem) return void (message.value = problem);
  const reply = m ? await props.send('tool', { tool: m.id, params: { die: die.id, cell: index } }) : await props.send('place', { die: die.id, cell: index });
  if (reply.ok) {
    selected.value = null;
    mode.value = null;
  } else message.value = reply.error;
}

function clickMoveCell(m, index) {
  const grid = m.grid;
  if (m.from === null) {
    if (!grid[index]) return void (message.value = 'First click the die in your window that you want to move.');
    if (m.moves.some((mv) => mv.to === index)) return void (message.value = 'That die has already been moved.');
    const first = m.moves.length ? grid[m.moves[0].to] : null;
    if (m.sameColour && first && grid[index].c !== first.c) return void (message.value = `The second die must also be ${colourName(first.c)}.`);
    m.from = index;
    return;
  }
  if (index === m.from) {
    m.from = null;
    return;
  }
  const problem = moveProblem(grid, pattern.value, m.from, index, m.options);
  if (problem) return void (message.value = problem);
  const next = grid.slice();
  next[index] = next[m.from];
  next[m.from] = null;
  m.moves.push({ from: m.from, to: index });
  m.grid = next;
  m.from = null;
  if (m.moves.length >= m.max) applyTool();
}

// ---- tools ----
const toolBlock = (tool) => {
  if (s.value.phase !== 'playing') return 'The game is not being played.';
  if (!myTurn.value) return 'Not your turn.';
  if (s.value.turn.toolUsed) return 'You have already used a tool this turn.';
  if ((me.value?.tokens ?? 0) < tool.cost) return `You need ${tool.cost} favour ${tool.cost === 1 ? 'token' : 'tokens'}; you have ${me.value?.tokens ?? 0}.`;
  return '';
};

function startTool(tool) {
  message.value = '';
  const reason = toolBlock(tool);
  if (reason) return void (message.value = reason);
  if (mode.value?.id === tool.id) return void (mode.value = null);
  selected.value = null;
  mode.value = startMode(tool, me.value.window.grid);
}

const toolParams = computed(() => {
  const m = mode.value;
  if (!m) return null;
  if (m.kind === 'pool') return m.die == null ? null : { die: m.die };
  if (m.kind === 'exchange') return m.die == null || m.trackDie == null ? null : { die: m.die, trackDie: m.trackDie };
  if (m.kind === 'confirm') return {};
  if (m.kind === 'moves') return m.moves.length >= m.min ? { moves: m.moves } : null;
  return null;
});

async function applyTool(extra = {}) {
  const m = mode.value;
  if (!m) return;
  const params = m.kind === 'moves' ? { moves: m.moves } : m.kind === 'delta' ? { die: m.die, ...extra } : { ...toolParams.value, ...extra };
  const reply = await props.send('tool', { tool: m.id, params });
  if (reply.ok) mode.value = null;
  else {
    message.value = reply.error;
    if (m.kind === 'moves') {
      m.moves = [];
      m.from = null;
      m.grid = me.value.window.grid;
    }
  }
}

const modeDie = computed(() => (mode.value?.die == null ? null : poolDie(mode.value.die)));
const modeSummary = computed(() => {
  const m = mode.value;
  if (!m) return '';
  if (m.kind === 'moves') return `${m.moves.length} of ${m.min === m.max ? m.max : `${m.min} to ${m.max}`} dice moved${m.from !== null ? '; now click where it goes' : ''}.`;
  if (m.kind === 'exchange') return `${m.die != null ? 'Pool die chosen' : 'Choose a pool die'}; ${m.trackDie != null ? 'track die chosen' : 'now a die on the round track'}.`;
  if (m.kind === 'free') return m.die != null ? 'Now click the space for it.' : 'Choose a pool die.';
  if (m.kind === 'confirm') return 'Nothing more to choose.';
  return m.die != null ? 'Die chosen.' : 'Choose a die in the pool.';
});

// ---- placing messages and ending the turn ----
const status = computed(() => {
  if (finished.value) return 'The game is over.';
  if (!myTurn.value) return `Waiting for ${nameOf(s.value.turn?.seat)}…`;
  const t = s.value.turn;
  const die = t.placements < t.allowed ? 'place a die' : 'your die is placed';
  const tool = t.toolUsed ? 'your tool is used' : 'you may use a tool';
  return `Your ${turnNumber.value} turn: ${die}; ${tool}. End your turn when you are done.`;
});
const endHint = computed(() => (myTurn.value && s.value.turn.placements === 0 && s.value.pool.length ? 'You have not placed a die yet.' : ''));

async function endTurn() {
  const reply = await props.send('end');
  if (!reply.ok) message.value = reply.error;
}

const winners = computed(() => (s.value.winners ?? []).map(nameOf));
const rank = (row) => (row.placement === 1 ? 'Winner' : `${row.placement}th`.replace(/^2th/, '2nd').replace(/^3th/, '3rd'));
const myPrivateRule = computed(() =>
  s.value.badPrivate ? 'Bad private scoring is on: each of your private-colour dice is worth a flat 3, whatever it shows.' : 'Each die of this colour in your window scores its shade (pips).',
);
const trackSlots = computed(() => Array.from({ length: s.value.limits.rounds }, (_, i) => s.value.track?.[i] ?? null));
const shapeOf = (c) => SHAPES[SHAPE_OF[c]];
</script>

<template>
  <div class="table-view stack">
    <ScoreBoard ref="board" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished">
      <template #round>
        <p v-if="!finished" class="provisional" role="note">
          <strong>Provisional scores.</strong> They count public objectives, favour tokens and empty spaces. Private objectives are added at the end, and each is shown only to its owner until then. Round 1 includes everyone's starting tokens less their 20 empty spaces.
        </p>
        <p v-else class="provisional" role="note">Final scores include the private objectives (the last row).</p>
      </template>
    </ScoreBoard>

    <p v-if="!finished" class="provisional-bar muted">
      Scores are <strong>provisional</strong> until the end: private objectives are not counted yet.
      <span v-if="state.settings.badPrivate" class="tag">Bad private scoring</span>
    </p>

    <!-- Choosing windows -->
    <section v-if="windows" class="panel stack windows-phase">
      <h3>Choose your window</h3>
      <p class="muted">Everyone chooses at the same time, and nobody sees the others' choices until all are in. A harder window gives more favour tokens.</p>
      <div v-if="state.options.length" class="options">
        <div
          v-for="o in state.options"
          :key="o.pid"
          class="option"
          :class="{ picked: picked === o.pid || state.chosen === o.pid, locked: Boolean(state.chosen) }"
          :role="state.chosen ? undefined : 'button'"
          :tabindex="state.chosen ? undefined : 0"
          @click="!state.chosen && (picked = o.pid)"
          @keydown.enter.prevent="!state.chosen && (picked = o.pid)"
        >
          <WindowGrid :rows="o.rows" :cell="40" :label="o.name" />
          <div class="option-info">
            <strong>{{ o.name }}</strong>
            <span class="tokens" :title="`${o.difficulty} favour tokens`"><i v-for="n in o.difficulty" :key="n" class="token" />{{ o.difficulty }} favour tokens</span>
          </div>
        </div>
      </div>
      <div class="row">
        <button v-if="!state.chosen" class="primary" :disabled="!picked" @click="chooseWindow">Choose this window</button>
        <span v-else class="muted" role="status">You have chosen. Waiting for {{ waitingFor.join(', ') || 'the others' }}…</span>
        <button class="quiet" @click="send('leave')">Leave game</button>
      </div>
      <ul class="waiting" aria-label="Who has chosen">
        <li v-for="seat in state.seats" :key="seat.seat" :class="{ done: seat.picked }">
          {{ seat.name }}<span v-if="seat.bot" class="tag">computer</span><span v-else-if="!seat.online" class="tag away">away</span>
          <span class="state">{{ seat.picked ? 'has chosen' : 'choosing…' }}</span>
        </li>
      </ul>
    </section>

    <!-- The game -->
    <template v-else>
      <section class="info panel">
        <div class="row head">
          <strong>Round {{ state.round }} of {{ state.limits.rounds }}</strong>
          <span class="muted">{{ state.bagCount }} {{ state.bagCount === 1 ? 'die' : 'dice' }} left in the bag</span>
          <span class="muted">First player: {{ nameOf(state.first) }}</span>
        </div>
        <ol v-if="!finished" class="order" aria-label="Turn order this round">
          <li
            v-for="(seat, i) in state.order"
            :key="i"
            :class="{ now: i === state.turnIndex, past: i < state.turnIndex, skipped: i >= state.seats.length && state.seats[seat]?.skipping, me: seat === state.you }"
          >
            {{ nameOf(seat) }}
          </li>
        </ol>
        <p class="status" :class="{ mine: myTurn }" role="status">{{ status }}</p>
      </section>

      <div class="main">
        <div class="left stack">
          <div class="mine-row">
            <section class="panel stack mine" :class="{ turn: myTurn }">
              <div class="row head">
                <strong>{{ me?.name }}</strong><span class="muted">(you)</span>
                <span class="muted">{{ me?.window?.name }}</span>
                <span class="tokens" title="Favour tokens"><i v-for="n in me?.tokens ?? 0" :key="n" class="token" /><b>{{ me?.tokens }}</b> favour</span>
              </div>
              <WindowGrid
                v-if="me?.window"
                :rows="me.window.rows"
                :grid="myGrid"
                :cell="68"
                :legal="highlight.legal"
                :pick="highlight.pick"
                :chosen="highlight.chosen"
                :titles="highlight.titles"
                :interactive="myTurn"
                label="Your window"
                @cell="clickCell"
              />
              <p class="muted small">{{ me?.empty }} empty {{ me?.empty === 1 ? 'space' : 'spaces' }}. Provisional score {{ me?.score }}.</p>
            </section>

            <section class="panel stack pool-panel">
              <h3>The pool</h3>
              <div class="pool" role="group" aria-label="Draft pool">
                <div
                  v-for="d in state.pool"
                  :key="d.id"
                  class="pool-die"
                  :class="{ chosen: selected === d.id || mode?.die === d.id }"
                  role="button"
                  tabindex="0"
                  :aria-label="`${colourName(d.c)} ${d.v}`"
                  @click="clickPool(d)"
                  @keydown.enter.prevent="clickPool(d)"
                >
                  <Die :die="d" :size="54" />
                </div>
                <p v-if="!state.pool.length" class="muted">The pool is empty.</p>
              </div>
              <p v-if="!finished" class="muted small">Click a die, then a highlighted space in your window.</p>

              <div v-if="mode" class="guide stack" role="region" aria-label="Using a tool">
                <strong>{{ mode.name }} <span class="muted">(costs {{ mode.cost }} favour {{ mode.cost === 1 ? 'token' : 'tokens' }})</span></strong>
                <span>{{ mode.how }}</span>
                <span class="muted">{{ modeSummary }}</span>
                <div v-if="mode.kind === 'delta'" class="row">
                  <button :disabled="!modeDie || modeDie.v >= 6" @click="applyTool({ delta: 1 })">Raise by one</button>
                  <button :disabled="!modeDie || modeDie.v <= 1" @click="applyTool({ delta: -1 })">Lower by one</button>
                </div>
                <div class="row">
                  <button v-if="mode.kind !== 'delta' && mode.kind !== 'free'" class="primary" :disabled="!toolParams" @click="applyTool()">Use {{ mode.name }}</button>
                  <button class="quiet" @click="mode = null">Cancel</button>
                </div>
              </div>

              <div v-if="!finished" class="row actions">
                <button class="primary" :disabled="!myTurn" @click="endTurn">End turn</button>
                <span v-if="endHint" class="muted small">{{ endHint }}</span>
              </div>
              <p v-if="message" class="reason" role="alert">{{ message }}</p>
            </section>
          </div>

          <section class="panel stack">
            <h3>Round track</h3>
            <div class="track" role="group" aria-label="Round track">
              <div v-for="(dice, i) in trackSlots" :key="i" class="slot" :class="{ now: i + 1 === state.round && !finished }">
                <span class="muted n">{{ i + 1 }}</span>
                <div class="slot-dice">
                  <div v-for="d in dice ?? []" :key="d.id" class="track-die" :class="{ chosen: mode?.trackDie === d.id, live: mode?.kind === 'exchange' }" :role="mode?.kind === 'exchange' ? 'button' : undefined" @click="clickTrack(d)">
                    <Die :die="d" :size="26" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside class="right stack">
          <section class="panel stack">
            <h3>Tool cards</h3>
            <div
              v-for="tool in state.tools"
              :key="tool.id"
              class="tool"
              :class="{ active: mode?.id === tool.id, usable: !toolBlock(tool) }"
              role="button"
              tabindex="0"
              :title="toolBlock(tool) || 'Click to use this tool'"
              @click="startTool(tool)"
              @keydown.enter.prevent="startTool(tool)"
            >
              <div class="tool-head">
                <strong>{{ tool.name }}</strong>
                <span class="cost" :title="tool.spent ? 'Used before: it now costs 2' : 'Not used yet: it costs 1'">costs {{ tool.cost }}</span>
              </div>
              <p>{{ tool.text }}</p>
              <p class="muted small">How: {{ tool.how }}</p>
              <p class="muted small spent-line" :class="{ unused: !tool.spent }" :aria-hidden="tool.spent ? undefined : 'true'"><i v-for="n in tool.spent" :key="n" class="token spent" /> {{ tool.spent }} {{ tool.spent === 1 ? 'token' : 'tokens' }} on this card</p>
            </div>
          </section>

          <section class="panel stack">
            <h3>Public objectives</h3>
            <div v-for="o in state.publicObjectives" :key="o.id" class="objective">
              <div class="tool-head"><strong>{{ o.name }}</strong><span class="cost">{{ o.points }} per {{ o.unit }}</span></div>
              <p>{{ o.text }}</p>
              <p v-if="o.mine" class="muted small">You have {{ o.mine.sets }}: {{ o.mine.points }} points.</p>
            </div>
          </section>

          <section v-if="state.privateObjective" class="panel stack private">
            <h3>Your private objective</h3>
            <div class="row">
              <svg class="chip" viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
                <rect x="1" y="1" width="38" height="38" rx="8" :fill="COLOUR_HEX[state.privateObjective.colour]" />
                <path :d="shapeOf(state.privateObjective.colour)" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2" />
              </svg>
              <strong>{{ colourName(state.privateObjective.colour) }}</strong>
              <span class="muted">{{ state.privateObjective.points }} points so far</span>
            </div>
            <p class="muted small">{{ myPrivateRule }} Only you can see this until the end; it is not in the scores above yet.</p>
          </section>
        </aside>
      </div>

      <section v-if="others.length" class="panel stack">
        <h3>The other windows</h3>
        <div class="others">
          <div v-for="seat in others" :key="seat.seat" class="other" :class="{ turn: state.turn?.seat === seat.seat && !finished, away: !seat.bot && !seat.online }">
            <div class="row head">
              <strong>{{ seat.name }}</strong>
              <span v-if="seat.bot" class="tag">computer</span>
              <span v-else-if="!seat.online" class="tag away">away</span>
              <span v-if="seat.skipping" class="tag">skips turn 2</span>
            </div>
            <WindowGrid :rows="seat.window.rows" :grid="seat.window.grid" :cell="34" :label="`${seat.name}'s window`" />
            <p class="muted small">{{ seat.window.name }} · {{ seat.tokens }} tokens · {{ seat.empty }} empty · score {{ seat.score }}</p>
          </div>
        </div>
      </section>

      <section v-if="finished && state.final" class="panel stack final">
        <h3>{{ winners.length > 1 ? 'A shared win' : 'We have a winner' }}</h3>
        <p class="winner">{{ winners.join(' and ') }} {{ winners.length > 1 ? 'win' : 'wins' }} with {{ state.final.players[state.winners[0]].total }} points.</p>
        <div class="table-scroll">
          <table class="breakdown">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th v-for="o in state.publicObjectives" :key="o.id" scope="col">{{ o.name }}</th>
                <th scope="col">Private</th>
                <th scope="col">Favour tokens</th>
                <th scope="col">Empty spaces</th>
                <th scope="col">Total</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in state.final.players" :key="row.seat" :class="{ win: state.winners.includes(row.seat), me: row.seat === state.you }">
                <th scope="row">{{ row.name }}<span v-if="row.seat === state.you" class="muted"> (you)</span></th>
                <td v-for="p in row.publics" :key="p.id">{{ p.points }}<small class="muted"> ({{ p.sets }})</small></td>
                <td>
                  <span class="dot" :style="{ background: COLOUR_HEX[row.privateColour] }" />{{ colourName(row.privateColour) }}: <strong>{{ row.privatePoints }}</strong>
                </td>
                <td>+{{ row.tokens }}</td>
                <td>-{{ row.empty }}</td>
                <td><strong>{{ row.total }}</strong></td>
                <td>{{ rank(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">
          Private objective rule: {{ state.badPrivate ? 'bad private scoring (a flat 3 per die of the colour)' : 'the shade of every die of the colour, added up' }}. Ties are broken by private objective, then favour tokens, then whoever moved last in the final round.
        </p>
        <div class="row">
          <button v-if="state.hostSeat === state.you" class="primary" @click="send('again')">Play again</button>
          <span v-else class="muted">The host can start another game.</span>
          <button @click="board.show()">See the scores</button>
          <button class="quiet" @click="send('leave')">Leave game</button>
        </div>
      </section>

      <div class="row foot">
        <button v-if="!finished" class="quiet" @click="send('leave')">Leave game</button>
      </div>

      <section class="panel stack log-panel">
        <h3>Recent actions</h3>
        <GameLog class="log" :entries="state.log" newest-first empty="Nothing has happened yet." v-slot="{ entry }">
          <span :class="{ mine: entry.seat === state.you }">{{ entry.text }}</span>
        </GameLog>
      </section>
    </template>
  </div>
</template>

<style scoped>
.provisional {
  margin: 0 0 0.6rem;
  padding: 0.5rem 0.8rem;
  border: 1px dashed var(--amber);
  border-radius: 10px;
}
.provisional-bar {
  margin: 0;
  font-size: 0.85rem;
}
.tag {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.5rem;
  margin-left: 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--muted);
  color: var(--muted);
}
.tag.away {
  border-color: var(--danger);
  color: var(--danger);
}
.head {
  align-items: baseline;
  gap: 0.8rem;
}
.small {
  font-size: 0.85rem;
  margin: 0;
}
.tokens {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.token {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f6d58f, var(--amber) 60%, #9a6a1c);
  border: 1px solid #6d4a10;
}
.token.spent {
  opacity: 0.6;
}
.windows-phase .options {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.option {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.7rem;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
}
.option[role='button'] {
  cursor: pointer;
}
.option[role='button']:hover {
  border-color: #5b7885;
}
.option.picked {
  border-color: var(--amber);
}
.option.locked:not(.picked) {
  opacity: 0.55;
}
.option-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.waiting {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.4rem;
}
.waiting .state {
  margin-left: 0.4rem;
  color: var(--amber);
}
.waiting .done .state {
  color: var(--moss);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.order {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.order li {
  padding: 0.15rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--bg-sunken);
  font-size: 0.85rem;
}
.order li.past {
  opacity: 0.4;
}
.order li.now {
  border-color: var(--amber);
  background: var(--amber);
  color: var(--amber-ink);
  font-weight: 650;
}
.order li.skipped {
  text-decoration: line-through;
  opacity: 0.35;
}
.order li.me:not(.now) {
  border-color: var(--amber);
}
.status {
  margin: 0;
}
.status.mine {
  color: var(--amber);
  font-weight: 600;
}
.main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 1rem;
  align-items: start;
}
.mine-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
}
.mine {
  flex: 0 0 auto;
}
.mine.turn {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber);
}
.pool-panel {
  flex: 1 1 300px;
  min-width: 300px;
}
.pool {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.pool-die {
  padding: 3px;
  border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer;
}
.pool-die:hover {
  border-color: #5b7885;
}
.pool-die.chosen {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 22%, transparent);
}
.guide {
  padding: 0.7rem;
  border: 1px solid var(--amber);
  border-radius: 12px;
  background: color-mix(in srgb, var(--amber) 10%, var(--bg-sunken));
  gap: 0.4rem;
}
.actions {
  margin-top: 0.2rem;
}
.reason {
  margin: 0;
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--danger);
  border-radius: 10px;
  color: var(--danger);
}
.track {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.35rem;
}
.slot {
  min-height: 3.6rem;
  padding: 0.25rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-sunken);
}
.slot.now {
  border-color: var(--amber);
}
.slot .n {
  font-size: 0.7rem;
}
.slot-dice {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.track-die {
  border: 2px solid transparent;
  border-radius: 6px;
  line-height: 0;
}
.track-die.live {
  cursor: pointer;
}
.track-die.live:hover {
  border-color: #5b7885;
}
.track-die.chosen {
  border-color: var(--amber);
}
.tool {
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
  cursor: not-allowed;
  opacity: 0.8;
}
.tool.usable {
  cursor: pointer;
  opacity: 1;
}
.tool.usable:hover {
  border-color: var(--amber);
}
.tool.active {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber);
}
.tool p,
.objective p {
  margin: 0.2rem 0 0;
}
.tool-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: baseline;
}
.cost {
  font-size: 0.8rem;
  color: var(--amber);
  white-space: nowrap;
}
.objective {
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--line);
}
.objective:last-child {
  border-bottom: 0;
}
.private {
  border-color: var(--amber);
}
.chip {
  flex: none;
}
.others {
  display: flex;
  flex-wrap: wrap;
  gap: 1.2rem;
}
.other {
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: 12px;
}
.other.turn {
  border-color: var(--amber);
}
.other.away {
  opacity: 0.7;
}
.winner {
  margin: 0;
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
}
.table-scroll {
  overflow-x: auto;
}
.breakdown {
  border-collapse: collapse;
  width: 100%;
}
.breakdown th,
.breakdown td {
  padding: 0.4rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--line);
  vertical-align: baseline;
}
.breakdown thead th {
  font-size: 0.8rem;
  color: var(--muted);
  font-weight: 500;
}
.breakdown tr.win {
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}
.dot {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 3px;
  margin-right: 0.35rem;
}
.spent-line.unused {
  visibility: hidden; /* the line is always there, so a card does not grow when a token is put on it */
}
.log {
  --log-height: 9rem;
  font-size: 0.88rem;
  color: var(--muted);
}
.log .mine {
  color: var(--parchment);
}
.foot {
  justify-content: flex-end;
}
</style>
