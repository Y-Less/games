<script setup>
// The Gaudi table, built on the standard GameFrame: the score bar on top; your window (large) with the draft pool, the
// round track, the tool cards and the objectives in the main area; the other players are chips in the score bar (click a name to see
// their window over the table); Recent moves and Status along the bottom. The server sends the view; every action is one
// request.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import Die from './Die.vue';
import WindowGrid from './WindowGrid.vue';
import { COLOUR_HEX, SHAPES } from './glyphs.js';
import { startMode } from './toolkit.js';
import { CELLS, COLOUR_NAMES, COLOUR_SHAPES, cellProblem, moveProblem } from '../rules.js';
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
/** The name of a seat for the Status box ("Someone" if it is empty). */
const nameOf = (seat) => s.value.seats[seat]?.name ?? 'Someone';
const myTurn = computed(() => s.value.phase === 'playing' && s.value.turn?.seat === s.value.you);
const canPlace = computed(() => myTurn.value && s.value.turn.placements < s.value.turn.allowed);
const toolFree = computed(() => myTurn.value && !s.value.turn.toolUsed);
const pattern = computed(() => (me.value?.window ? { cells: me.value.window.rows.join('').split('') } : null));
const myGrid = computed(() => mode.value?.grid ?? me.value?.window?.grid ?? Array(CELLS).fill(null));
/** The die in the pool with this id, or null (it may have been placed or changed since the player clicked it). */
const poolDie = (id) => (s.value.pool ?? []).find((d) => d.id === id) ?? null;
const waitingFor = computed(() => s.value.seats.filter((seat) => seat && !seat.picked).map((seat) => seat.name));
const turnNumber = computed(() => (s.value.turn?.number === 2 ? 'second' : 'first'));
/** A colour's name for people ("Ruby"); an unknown colour is shown as it is. */
const colourName = (c) => COLOUR_NAMES[c] ?? c;

// ---- guided choices reset whenever the turn moves on ----
// The key names the turn. Swift Hand starts an extra turn for the same player without changing turnIndex, so whether the
// turn is the extra one is part of the key too (otherwise a die or tool chosen in the first turn would still be selected).
watch(
  () => `${s.value.round}:${s.value.turnIndex}:${s.value.phase}:${s.value.turn?.extra ? 'extra' : 'normal'}`,
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
/**
 * Sends the window picked in the options (the first step of the game). The pick is kept if the server refuses it, and
 * cleared once it is accepted.
 */
async function chooseWindow() {
  if (!picked.value) return;
  const reply = await props.send('window', { pid: picked.value });
  if (reply.ok) picked.value = null;
}

// ---- explanations for the spaces ----
/**
 * Which spaces of your window to mark for what you are doing now: spaces a chosen die may go on (with the reason on the
 * others as a hover title), dice a slide tool can pick up, and where a picked-up die may go.
 * @returns {{ legal: number[], pick: number[], chosen: number[], titles: Record<number, string> }}
 */
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
      for (let i = 0; i < CELLS; i++) {
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
    for (let i = 0; i < CELLS; i++) {
      const problem = cellProblem(grid, pattern.value, i, die, m?.options ?? {});
      if (problem === null) out.legal.push(i);
      else out.titles[i] = problem;
    }
  }
  return out;
});

// ---- clicking dice and spaces ----
/**
 * A die in the pool was clicked: it is chosen for the tool being used, or selected for placing (clicking it again clears it).
 * Writes a reason in the Status box when it cannot be used now.
 * @param {{ id: number }} die
 */
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

/** A die on the round track was clicked: only Exchange uses it (clicking it again clears it). */
function clickTrack(die) {
  if (mode.value?.kind !== 'exchange') return;
  mode.value.trackDie = mode.value.trackDie === die.id ? null : die.id;
}

/**
 * A space of your window was clicked: it is part of a slide tool, or the place for the selected pool die (a plain placement,
 * or Free Pane). Checks the rule on the screen first so that the player is told why, then asks the server.
 * @param {number} index  the space, 0 to CELLS - 1
 */
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

/**
 * A space was clicked while a slide tool is in use: first the die to move, then where it goes. When the tool has all the
 * moves it needs, the request is sent.
 * @param {object} m      the tool state from startMode (mutated: from, moves, grid)
 * @param {number} index  the space
 */
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
/**
 * Why a tool cannot be used right now, or '' if it can (not your turn, one already used, not enough favour tokens...).
 * @param {{ cost: number }} tool  a tool card from the view
 * @returns {string}
 */
const toolBlock = (tool) => {
  if (s.value.phase !== 'playing') return 'The game is not being played.';
  if (!myTurn.value) return 'Not your turn.';
  if (s.value.turn.toolUsed) return 'You have already used a tool this turn.';
  if ((me.value?.tokens ?? 0) < tool.cost) return `You need ${tool.cost} favour ${tool.cost === 1 ? 'token' : 'tokens'}; you have ${me.value?.tokens ?? 0}.`;
  return '';
};

/**
 * A tool card was clicked: begins guided use of it (clicking the same card again cancels). The server checks everything again.
 * @param {object} tool  a tool card from the view
 */
function startTool(tool) {
  message.value = '';
  const reason = toolBlock(tool);
  if (reason) return void (message.value = reason);
  if (mode.value?.id === tool.id) return void (mode.value = null);
  selected.value = null;
  mode.value = startMode(tool, me.value.window.grid);
}

/** The request parameters the guided choices add up to so far, or null while something is still to be chosen. */
const toolParams = computed(() => {
  const m = mode.value;
  if (!m) return null;
  if (m.kind === 'pool') return m.die == null ? null : { die: m.die };
  if (m.kind === 'exchange') return m.die == null || m.trackDie == null ? null : { die: m.die, trackDie: m.trackDie };
  if (m.kind === 'confirm') return {};
  if (m.kind === 'moves') return m.moves.length >= m.min ? { moves: m.moves } : null;
  return null;
});

/**
 * Sends the tool being used. A failed slide resets the moves the player made, since the window on screen was only a preview.
 * @param {object} [extra]  parameters added by the button pressed (such as delta for Lathe)
 */
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

/** The pool die chosen for the tool being used, if any. */
const modeDie = computed(() => (mode.value?.die == null ? null : poolDie(mode.value.die)));
/** A sentence saying how far the guided use of the tool has got (shown in Status). */
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
/** The headline in the Status box: what is happening and what you may do. */
const status = computed(() => {
  if (finished.value) return 'The game is over.';
  if (windows.value) return s.value.chosen ? `You have chosen. Waiting for ${waitingFor.value.join(', ') || 'the others'}…` : 'Choose your window.';
  if (!myTurn.value) return `Waiting for ${nameOf(s.value.turn?.seat)}…`;
  const t = s.value.turn;
  const die = t.placements < t.allowed ? 'place a die' : 'your die is placed';
  const tool = t.toolUsed ? 'your tool is used' : 'you may use a tool';
  return `Your ${t.extra ? 'extra' : turnNumber.value} turn: ${die}; ${tool}. Click End turn when you are happy.`;
});
/** A reminder when you are about to end your turn without having placed a die. */
const endHint = computed(() => (myTurn.value && s.value.turn.placements === 0 && s.value.pool.length ? 'You have not placed a die yet.' : ''));
/** How your private colour is scored in this game (it depends on the bad private scoring setting). */
const myPrivateRule = computed(() =>
  s.value.badPrivate ? 'Bad private scoring is on: each of your private-colour dice is worth a flat 3, whatever it shows.' : 'Each die of this colour in your window scores its shade (pips).',
);
/** Every line of the Status box, with its tone, for the phase the game is in. */
const statusLines = computed(() => {
  const lines = [];
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  if (windows.value) {
    if (s.value.privateObjective) lines.push({ text: `Your private objective is ${colourName(s.value.privateObjective.colour)}. ${myPrivateRule.value} Only you can see it until the end.`, tone: 'mine' });
    if (hint.value) lines.push({ text: hint.value, tone: 'muted' });
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
  if (myTurn.value && s.value.turn.canUndo) lines.push({ text: 'You can change your mind until you click End turn: Undo turn takes this whole turn back.', tone: 'muted' });
  if (!finished.value) {
    lines.push({ text: `Your window: ${me.value?.empty} empty ${me.value?.empty === 1 ? 'space' : 'spaces'}, provisional score ${me.value?.score}.`, tone: 'muted' });
    lines.push({ text: 'Scores are provisional until the end: private objectives are not counted yet.', tone: 'muted' });
    if (s.value.privateObjective) lines.push({ text: `Your private objective, ${colourName(s.value.privateObjective.colour)} (${s.value.privateObjective.points} points so far): ${myPrivateRule.value} Only you can see it until the end.`, tone: 'muted' });
  }
  return lines;
});
/** What a tool card does, shown in Status while the pointer is on it. */
const toolHint = (tool) => `${tool.name}: ${tool.text} How: ${tool.how}`;
/** What an objective card asks for and what you have of it so far, shown in Status while the pointer is on it. */
const objectiveHint = (o) => `${o.name}: ${o.text} ${o.points} per ${o.unit}.${o.mine ? ` You have ${o.mine.sets}: ${o.mine.points} points.` : ''}`;

/** Takes the whole turn back (server side) and clears any half-made choice on the screen. */
async function undoTurn() {
  const reply = await props.send('undo');
  selected.value = null;
  mode.value = null;
  message.value = reply.ok ? '' : reply.error;
}

/** Ends your turn; shows the server's reason if it refuses. */
async function endTurn() {
  const reply = await props.send('end');
  if (!reply.ok) message.value = reply.error;
}

const winners = computed(() => (s.value.winners ?? []).map(nameOf));
/** The place in the final table in words ("Winner", "2nd", "3rd", "4th"). */
const rank = (row) => (row.placement === 1 ? 'Winner' : `${row.placement}th`.replace(/^2th/, '2nd').replace(/^3th/, '3rd'));
const trackSlots = computed(() => Array.from({ length: s.value.limits.rounds }, (_, i) => s.value.track?.[i] ?? null));
/** The outline (SVG path) of the shape that marks a colour. */
const shapeOf = (c) => SHAPES[COLOUR_SHAPES[c]];
const poolMax = computed(() => 2 * (s.value.size ?? s.value.seats.length) + 1);

// ---- other players' windows: hidden until you click their name in the score bar, one at a time, over the main area
// (nothing moves) ----
const { openId, scoreProps, popupProps, close: closePopup } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostSeat,
  isHost: () => s.value.hostSeat === s.value.you,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
const openedPlayer = computed(() => s.value.seats.find((o) => o && o.seat === openId.value) ?? null); // yours too
const openedSeat = computed(() => (openedPlayer.value?.window ? openedPlayer.value : null));
const openedIsMe = computed(() => openedPlayer.value !== null && openedPlayer.value.seat === s.value.you);

// ---- fitting the room: everything is sized from the area the frame gives the table ----
/**
 * Works out every size on the table from the area the frame gives it (see layout.js).
 * @param {object} area  { width, height, left, columns, gap, mainSpan }
 * @returns {object} cell, die, perRow, poolHeight, trackDie, option and popup sizes in pixels
 */
const dims = (area) => tableSizes(area, { poolMax: poolMax.value, finished: finished.value, options: s.value.options?.length ?? 4 });
</script>

<template>
  <GameFrame class="table-view" :main-span="8">
    <template #scorebar>
      <ScoreBoard ref="board" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished" :sticky="false" :round-popups="false" v-bind="scoreProps">
        <template #round>
          <p v-if="!finished" class="provisional" role="note">
            <strong>Provisional scores.</strong> They count public objectives, favour tokens and empty spaces. Private objectives are added at the end, and each is shown only to its owner until then. Round 1 includes everyone's starting tokens less their 20 empty spaces.
          </p>
          <p v-else class="provisional" role="note">Final scores include the private objectives (the last row).</p>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <section v-if="openedSeat" class="popup-window">
          <div class="head">
            <span v-if="openedSeat.skipping" class="tag">skips turn 2</span>
            <span class="muted wname">{{ openedSeat.window.name }}</span>
          </div>
          <WindowGrid :rows="openedSeat.window.rows" :grid="openedSeat.window.grid" :cell="dims(area).popup" :label="`${openedSeat.name}'s window`" />
          <p class="muted small">{{ openedSeat.tokens }} tokens · {{ openedSeat.empty }} empty · score {{ openedSeat.score }}</p>
        </section>
        <p v-else-if="openedPlayer?.picked && windows" class="muted small">{{ openedIsMe ? 'You have chosen a window.' : 'Has chosen a window.' }} It stays hidden until everyone has chosen.</p>
        <p v-else class="muted small">{{ openedIsMe ? 'You are still choosing a window.' : 'Still choosing a window.' }}</p>
      </PlayerPopup>
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
        <div v-if="state.privateObjective" class="deal" aria-label="The cards dealt for this game">
          <section class="furniture" aria-label="Tool cards">
            <span class="row-title">Tool cards</span>
            <div class="deal-items">
              <div v-for="tool in state.tools" :key="tool.id" class="tool" tabindex="0" @mouseenter="hint = toolHint(tool)" @mouseleave="hint = ''" @focus="hint = toolHint(tool)" @blur="hint = ''">
                <div class="tool-head"><strong>{{ tool.name }}</strong><span class="cost">costs {{ tool.cost }}</span></div>
                <p class="line">{{ tool.text }}</p>
              </div>
            </div>
          </section>
          <section class="furniture" aria-label="Public objectives">
            <span class="row-title">Public objectives</span>
            <div class="deal-items">
              <div v-for="o in state.publicObjectives" :key="o.id" class="objective" tabindex="0" @mouseenter="hint = objectiveHint(o)" @mouseleave="hint = ''" @focus="hint = objectiveHint(o)" @blur="hint = ''">
                <div class="tool-head"><strong>{{ o.name }}</strong><span class="cost">{{ o.points }} per {{ o.unit }}</span></div>
                <p class="line">{{ o.text }}</p>
              </div>
            </div>
          </section>
          <section class="furniture private" aria-label="Your private objective" @mouseenter="hint = `Your private objective: ${colourName(state.privateObjective.colour)}. ${myPrivateRule}`" @mouseleave="hint = ''">
            <svg class="chip" viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
              <rect x="1" y="1" width="38" height="38" rx="8" :fill="COLOUR_HEX[state.privateObjective.colour]" />
              <path :d="shapeOf(state.privateObjective.colour)" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2" />
            </svg>
            <div class="private-text">
              <span class="row-title">Your private objective</span>
              <span class="private-line"><strong>{{ colourName(state.privateObjective.colour) }}</strong></span>
            </div>
          </section>
        </div>
      </section>

      <!-- The game -->
      <div v-else class="arena">
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
                  <button :disabled="!myTurn || !state.turn?.canUndo" title="Take this whole turn back to how it began" @click="undoTurn">Undo turn</button>
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
.deal {
  flex: none;
  width: 100%;
  display: grid;
  grid-template-columns: 5fr 5fr 2fr;
  gap: 12px;
  align-items: start;
}
.deal-items {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.deal .tool {
  cursor: default;
  opacity: 1;
}
.deal .private {
  align-self: end;
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
  padding: 0.4rem 0 0.5rem;
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
.popup-window {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.popup-window .head {
  display: flex;
  align-items: baseline;
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
