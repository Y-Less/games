<script setup>
// The Gaudi table, built on the standard GameFrame: the score bar on top; your window (large) with the draft pool, the
// round track, the tool cards and the objectives in the main area; the other players are chips in the score bar (click a name to see
// their window over the table); Recent moves and Status along the bottom. The server sends the view; every action is one
// request.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import Die from './Die.vue';
import WindowGrid from './WindowGrid.vue';
import { COLOUR_HEX, COLOUR_LABEL, SHAPES, SHAPE_OF } from './glyphs.js';
import { startMode } from './toolkit.js';
import { cellProblem, moveProblem } from '../rules.js';
import { tableSizes } from './layout.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const board = ref(null);
const selected = ref(null); // the pool die chosen for placing
const mode = ref(null); // a tool being used
const message = ref('');
const picked = ref(null); // the window chosen but not yet confirmed
const hint = ref(''); // what the tool or objective under the pointer does (shown in Status)

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
const others = computed(() => {
  const n = s.value.seats.length;
  const out = [];
  for (let k = 1; k < n; k++) {
    const seat = s.value.seats[(Math.max(0, s.value.you) + k) % n];
    if (seat) out.push(seat);
  }
  return out;
});
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

// ---- the words in the Status box ----
const status = computed(() => {
  if (finished.value) return 'The game is over.';
  if (windows.value) return s.value.chosen ? `You have chosen. Waiting for ${waitingFor.value.join(', ') || 'the others'}…` : 'Choose your window.';
  if (!myTurn.value) return `Waiting for ${nameOf(s.value.turn?.seat)}…`;
  const t = s.value.turn;
  const die = t.placements < t.allowed ? 'place a die' : 'your die is placed';
  const tool = t.toolUsed ? 'your tool is used' : 'you may use a tool';
  return `Your ${t.extra ? 'extra' : turnNumber.value} turn: ${die}; ${tool}. End your turn when you are done.`;
});
const endHint = computed(() => (myTurn.value && s.value.turn.placements === 0 && s.value.pool.length ? 'You have not placed a die yet.' : ''));
const myPrivateRule = computed(() =>
  s.value.badPrivate ? 'Bad private scoring is on: each of your private-colour dice is worth a flat 3, whatever it shows.' : 'Each die of this colour in your window scores its shade (pips).',
);
const statusLines = computed(() => {
  const lines = [];
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  if (windows.value) {
    lines.push({ text: 'Everyone chooses at the same time, and nobody sees the others\' choices until all are in. A harder window gives more favour tokens.', tone: 'muted' });
    lines.push({ text: s.value.seats.filter(Boolean).map((seat) => `${seat.name}: ${seat.picked ? 'has chosen' : 'choosing…'}`).join(' · '), tone: 'muted' });
    return lines;
  }
  if (mode.value) {
    lines.push({ text: `${mode.value.name} (costs ${mode.value.cost} favour ${mode.value.cost === 1 ? 'token' : 'tokens'}): ${mode.value.how}`, tone: 'mine' });
    lines.push({ text: modeSummary.value, tone: 'muted' });
  } else if (hint.value) lines.push({ text: hint.value, tone: 'muted' });
  else if (myTurn.value) lines.push({ text: 'Click a die in the pool, then a highlighted space in your window.', tone: 'muted' });
  if (myTurn.value && s.value.turn.extra) lines.push({ text: 'Extra turn (Swift Hand): a whole new turn, so choose another die and use more favour tokens if you wish. Your second turn of the round is skipped.', tone: 'mine' });
  else if (myTurn.value && s.value.turn.swift) lines.push({ text: 'Swift Hand is active: when you end this turn you take an extra turn straight away, and your second turn of the round is skipped.', tone: 'mine' });
  if (endHint.value && !mode.value) lines.push({ text: endHint.value, tone: 'muted' });
  if (!finished.value) {
    lines.push({ text: `Your window: ${me.value?.empty} empty ${me.value?.empty === 1 ? 'space' : 'spaces'}, provisional score ${me.value?.score}.`, tone: 'muted' });
    lines.push({ text: 'Scores are provisional until the end: private objectives are not counted yet.', tone: 'muted' });
    if (s.value.privateObjective) lines.push({ text: `Your private objective, ${colourName(s.value.privateObjective.colour)} (${s.value.privateObjective.points} points so far): ${myPrivateRule.value} Only you can see it until the end.`, tone: 'muted' });
  }
  return lines;
});
const toolHint = (tool) => `${tool.name}: ${tool.text} How: ${tool.how}`;
const objectiveHint = (o) => `${o.name}: ${o.text} ${o.points} per ${o.unit}.${o.mine ? ` You have ${o.mine.sets}: ${o.mine.points} points.` : ''}`;

async function endTurn() {
  const reply = await props.send('end');
  if (!reply.ok) message.value = reply.error;
}

const winners = computed(() => (s.value.winners ?? []).map(nameOf));
const rank = (row) => (row.placement === 1 ? 'Winner' : `${row.placement}th`.replace(/^2th/, '2nd').replace(/^3th/, '3rd'));
const trackSlots = computed(() => Array.from({ length: s.value.limits.rounds }, (_, i) => s.value.track?.[i] ?? null));
const shapeOf = (c) => SHAPES[SHAPE_OF[c]];
const poolMax = computed(() => 2 * (s.value.size ?? s.value.seats.length) + 1);

// ---- other players' windows: hidden until you click their name in the score bar, one at a time, over the main area
// (nothing moves) ----
const openSeat = ref(null);
const hasWindow = (seat) => !windows.value && seat !== s.value.you && others.value.some((o) => o.seat === seat && o.window);
const openedSeat = computed(() => others.value.find((o) => o.seat === openSeat.value && o.window) ?? null);
watch(
  () => others.value.map((o) => o.seat).join(),
  () => {
    if (openSeat.value !== null && !others.value.some((o) => o.seat === openSeat.value)) openSeat.value = null;
  },
);
watch(windows, () => (openSeat.value = null));
const closeOnOutside = (event) => {
  if (openSeat.value !== null && !event.target.closest?.('.score-bar .chip-button, .popup')) openSeat.value = null;
};
const closeOnEsc = (event) => event.key === 'Escape' && (openSeat.value = null);
onMounted(() => {
  document.addEventListener('click', closeOnOutside);
  window.addEventListener('keydown', closeOnEsc);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnOutside);
  window.removeEventListener('keydown', closeOnEsc);
});

// ---- fitting the room: everything is sized from the area the frame gives the table ----
const dims = (area) => tableSizes(area, { poolMax: poolMax.value, finished: finished.value, options: s.value.options?.length ?? 4 });
</script>

<template>
  <GameFrame class="table-view" :main-span="8">
    <template #scorebar>
      <ScoreBoard ref="board" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished" :sticky="false" :round-popups="false" :has-details="hasWindow" :open-details="openSeat" @details="(seat) => (openSeat = seat)">
        <template #round>
          <p v-if="!finished" class="provisional" role="note">
            <strong>Provisional scores.</strong> They count public objectives, favour tokens and empty spaces. Private objectives are added at the end, and each is shown only to its owner until then. Round 1 includes everyone's starting tokens less their 20 empty spaces.
          </p>
          <p v-else class="provisional" role="note">Final scores include the private objectives (the last row).</p>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <!-- Choosing windows -->
      <section v-if="windows" class="windows-phase" aria-label="Choose your window">
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
            <WindowGrid :rows="o.rows" :cell="dims(area).option" :label="o.name" />
            <div class="option-info">
              <strong>{{ o.name }}</strong>
              <span class="tokens" :title="`${o.difficulty} favour tokens`"><i v-for="n in o.difficulty" :key="n" class="token" />{{ o.difficulty }} favour tokens</span>
            </div>
          </div>
        </div>
        <div class="row choose-row">
          <button class="primary" :disabled="!picked || Boolean(state.chosen)" @click="chooseWindow">Choose this window</button>
        </div>
      </section>

      <!-- The game -->
      <div v-else class="arena">
        <div v-if="openedSeat" class="popup" role="group" :aria-label="`${openedSeat.name}'s window`">
          <section class="popup-window">
            <div class="head">
              <strong>{{ openedSeat.name }}</strong>
              <span v-if="openedSeat.skipping" class="tag">skips turn 2</span>
              <span class="muted wname">{{ openedSeat.window.name }}</span>
            </div>
            <WindowGrid :rows="openedSeat.window.rows" :grid="openedSeat.window.grid" :cell="dims(area).popup" :label="`${openedSeat.name}'s window`" />
            <p class="muted small">{{ openedSeat.tokens }} tokens · {{ openedSeat.empty }} empty · score {{ openedSeat.score }}</p>
          </section>
        </div>
        <div class="mine-col" :style="{ gridColumn: `span ${finished ? 4 : area.mainSpan}` }">
          <section class="mine" :class="{ turn: myTurn }">
            <div class="head">
              <strong>{{ me?.name }}</strong><span class="muted">(you)</span>
              <span class="muted wname">{{ me?.window?.name }}</span>
              <span class="tokens" title="Favour tokens"><i v-for="n in me?.tokens ?? 0" :key="n" class="token" /><b>{{ me?.tokens }}</b> favour</span>
            </div>
            <div class="play">
              <WindowGrid
                v-if="me?.window"
                :rows="me.window.rows"
                :grid="myGrid"
                :cell="dims(area).cell"
                :legal="highlight.legal"
                :pick="highlight.pick"
                :chosen="highlight.chosen"
                :titles="highlight.titles"
                :interactive="myTurn"
                label="Your window"
                @cell="clickCell"
              />

              <div v-if="!finished" class="pool-col">
                <div class="pool" role="group" aria-label="Draft pool" :style="{ gridTemplateColumns: `repeat(${dims(area).perRow}, auto)`, minHeight: `${dims(area).poolHeight}px` }">
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
                    <Die :die="d" :size="dims(area).die" />
                  </div>
                </div>

                <div class="actions">
                  <button class="primary" :disabled="!myTurn" @click="endTurn">End turn</button>
                  <template v-if="mode">
                    <button v-if="mode.kind === 'delta'" :disabled="!modeDie || modeDie.v >= 6" @click="applyTool({ delta: 1 })">Raise by one</button>
                    <button v-if="mode.kind === 'delta'" :disabled="!modeDie || modeDie.v <= 1" @click="applyTool({ delta: -1 })">Lower by one</button>
                    <button v-if="mode.kind !== 'delta' && mode.kind !== 'free'" class="primary" :disabled="!toolParams" @click="applyTool()">Use {{ mode.name }}</button>
                    <button class="quiet" @click="mode = null">Cancel</button>
                  </template>
                </div>

                <div class="track" role="group" aria-label="Round track">
                  <div v-for="(dice, i) in trackSlots" :key="i" class="slot" :class="{ now: i + 1 === state.round && !finished }" :title="`Round ${i + 1}`">
                    <span class="muted n">{{ i + 1 }}</span>
                    <div class="slot-dice">
                      <div v-for="d in dice ?? []" :key="d.id" class="track-die" :class="{ chosen: mode?.trackDie === d.id, live: mode?.kind === 'exchange' }" :role="mode?.kind === 'exchange' ? 'button' : undefined" @click="clickTrack(d)">
                        <Die :die="d" :size="dims(area).trackDie" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div v-if="!finished" class="right-col" :style="{ gridColumn: `span ${area.columns - area.mainSpan}` }">
          <section class="furniture" aria-label="Tool cards">
            <span class="row-title">Tool cards</span>
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
              @mouseenter="hint = toolHint(tool)"
              @mouseleave="hint = ''"
              @focus="hint = toolHint(tool)"
              @blur="hint = ''"
            >
              <div class="tool-head">
                <strong>{{ tool.name }}</strong>
                <span class="cost" :title="tool.spent ? 'Used before: it now costs 2' : 'Not used yet: it costs 1'">
                  <i v-for="n in tool.spent" :key="n" class="token spent" :title="`${tool.spent} ${tool.spent === 1 ? 'token' : 'tokens'} on this card`" />
                  costs {{ tool.cost }}
                </span>
              </div>
              <p class="line">{{ tool.text }}</p>
            </div>
          </section>

          <section class="furniture" aria-label="Public objectives">
            <span class="row-title">Public objectives</span>
            <div v-for="o in state.publicObjectives" :key="o.id" class="objective" tabindex="0" @mouseenter="hint = objectiveHint(o)" @mouseleave="hint = ''" @focus="hint = objectiveHint(o)" @blur="hint = ''">
              <div class="tool-head">
                <strong>{{ o.name }}</strong>
                <span class="cost">{{ o.points }} per {{ o.unit }}<template v-if="o.mine"> · you {{ o.mine.sets }}</template></span>
              </div>
              <p class="line">{{ o.text }}</p>
            </div>
          </section>

          <section v-if="state.privateObjective" class="furniture private" aria-label="Your private objective" @mouseenter="hint = `Your private objective: ${colourName(state.privateObjective.colour)}. ${myPrivateRule}`" @mouseleave="hint = ''">
            <svg class="chip" viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
              <rect x="1" y="1" width="38" height="38" rx="8" :fill="COLOUR_HEX[state.privateObjective.colour]" />
              <path :d="shapeOf(state.privateObjective.colour)" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2" />
            </svg>
            <div class="private-text">
              <span class="row-title">Your private objective</span>
              <span class="private-line"><strong>{{ colourName(state.privateObjective.colour) }}</strong> <span class="muted">· {{ state.privateObjective.points }} points so far</span></span>
            </div>
          </section>
        </div>

        <section v-if="finished && state.final" class="final" :style="{ gridColumn: `span ${area.columns - 4}` }">
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
            <span v-else class="muted">The host can start another game, or leave (top right).</span>
            <button @click="board.show()">See the scores</button>
          </div>
        </section>
      </div>
    </template>

    <template #log>
      <GameLog :entries="state.log" newest-first empty="Nothing has happened yet." v-slot="{ entry }">
        <span :class="{ own: entry.seat === state.you }">{{ entry.text }}</span>
      </GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="(myTurn && !finished) || (windows && !state.chosen)" :lines="statusLines">
        <template #facts>
          <strong v-if="!windows">Round {{ state.round }} of {{ state.limits.rounds }}</strong>
          <span v-if="!windows">{{ state.bagCount }} {{ state.bagCount === 1 ? 'die' : 'dice' }} left in the bag</span>
          <span v-if="!windows">First player: {{ nameOf(state.first) }}</span>
          <span v-if="state.settings.badPrivate" class="tag">Bad private scoring</span>
          <ol v-if="!windows && !finished" class="order" aria-label="Turn order this round">
            <li
              v-for="(seat, i) in state.order"
              :key="i"
              :class="{ now: i === state.turnIndex, past: i < state.turnIndex, skipped: i >= state.seats.length && state.seats[seat]?.skipping, me: seat === state.you }"
            >
              {{ nameOf(seat) }}
            </li>
          </ol>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.provisional {
  margin: 0 0 0.6rem;
  padding: 0.5rem 0.8rem;
  border: 1px dashed var(--amber);
  border-radius: 10px;
}
.tag {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--muted);
  color: var(--muted);
  white-space: nowrap;
}
.tag.away {
  border-color: var(--danger);
  color: var(--danger);
}
.tag.turn-tag {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
  font-weight: 650;
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
  width: 0.6rem;
  height: 0.6rem;
}

/* ---- choosing windows ---- */
.windows-phase {
  grid-column: 1 / -1;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
}
.options {
  display: flex;
  justify-content: center;
  gap: 1rem;
}
.option {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem;
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
.choose-row {
  flex: none;
}

/* ---- the table: your window and the pool on the left, the cards and objectives on the right ---- */
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  min-height: 0;
}
.mine-col,
.right-col {
  min-width: 0;
  min-height: 0;
}
.mine-col {
  display: flex;
}
.mine {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0.4rem 0.6rem 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--radius);
}
.mine.turn {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber);
}
.head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  height: 1.5rem;
  white-space: nowrap;
  overflow: hidden;
}
.wname {
  overflow: hidden;
  text-overflow: ellipsis;
}
.play {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.play :deep(.window) {
  flex: none;
}
.pool-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pool {
  display: grid;
  justify-content: start;
  align-content: start;
  gap: 4px 6px;
}
.pool-die {
  padding: 3px;
  border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer;
  line-height: 0;
}
.pool-die:hover {
  border-color: #5b7885;
}
.pool-die.chosen {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 22%, transparent);
}
.actions {
  flex: none;
  height: 2.4rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
}
.actions button {
  white-space: nowrap;
}
.track {
  flex: none;
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
}
.slot {
  height: 4.4rem;
  padding: 0.15rem 0.2rem;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-sunken) 80%, transparent);
}
.slot.now {
  border-color: var(--amber);
}
.slot .n {
  font-size: 0.7rem;
  line-height: 1;
}
.slot-dice {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  align-content: flex-start;
  height: calc(100% - 0.8rem);
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

.right-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}
.furniture {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  line-height: 1.1;
}
.tool,
.objective {
  min-width: 0;
  padding: 0.25rem 0.6rem 0.3rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-sunken) 85%, transparent);
  cursor: default;
}
.tool {
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
.tool-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.9rem;
  white-space: nowrap;
}
.tool-head strong {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cost {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex: none;
  font-size: 0.78rem;
  color: var(--amber);
}
.line {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.private {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--amber);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-sunken) 85%, transparent);
}
.private-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 0.85rem;
}
.private-line {
  white-space: nowrap;
}
.own {
  color: var(--parchment);
}
.chip {
  flex: none;
}

/* ---- the turn order chips in the Status box ---- */
.order {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.order li {
  padding: 0 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--bg-sunken);
  font-size: 0.78rem;
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

/* ---- another player's window, over the middle of the table ---- */
.arena {
  position: relative;
}
.popup {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  filter: drop-shadow(0 6px 18px rgb(0 0 0 / 0.55));
}
.popup-window {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0.5rem 0.7rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-sunken) 94%, transparent);
}
.popup-window .head {
  gap: 0.5rem;
}

/* ---- the end ---- */
.final {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
}
.final h3 {
  margin: 0;
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
  font-size: 0.9rem;
}
.breakdown th,
.breakdown td {
  padding: 0.3rem 0.5rem;
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
</style>
