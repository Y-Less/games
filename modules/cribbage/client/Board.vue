<script setup>
// The cribbage board: a snaking track of holes (30 to a row), one lane per player, with a front and a back peg each.
// Drawn as SVG in its own coordinates, so it scales to whatever box it is put in.
//
// Props:
//   seats      {Array}   required. [{ seat, name, score, back }]: the front peg sits on `score`, the back peg on `back`.
//   target     {number}  required. The winning score (the last hole); the track has target / 30 rows.
//   skunkLine  {number}  the score marking the skunk line, or null for none.
//   you        {number}  the viewer's seat, to emphasise their front peg (default -1).
// Emits: none. Slots: none.
// Side effects: none (pure rendering).
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import { seatColour } from './colours.js';

const { t, list } = useGameText();
const props = defineProps({
  seats: { type: Array, required: true }, // [{ seat, name, score, back }]
  target: { type: Number, required: true },
  skunkLine: { type: Number, default: null },
  you: { type: Number, default: -1 },
});

const STEP = 12; // distance between neighbouring holes, in SVG units
const LANE = 11; // distance between players' lanes within a row
const PAD = 10; // margin around the track
const ROW_GAP = 9; // extra space between rows
const SLOTS = 31; // columns across the drawing: the start hole's column plus the 30 holes of a row

// Number of rows of 30 holes the track has.
const rows = computed(() => Math.floor(props.target / 30));
// One lane per player.
const laneCount = computed(() => props.seats.length);
// Height of one row: all the lanes plus the gap.
const rowHeight = computed(() => laneCount.value * LANE + ROW_GAP);
// Fixed drawing width (the number of columns never changes).
const width = PAD * 2 + (SLOTS - 1) * STEP;
// Drawing height, which depends on the number of rows and lanes.
const height = computed(() => PAD * 2 + rows.value * rowHeight.value - ROW_GAP + 4);

/**
 * Works out where a hole sits on the board. Even rows run left to right and odd rows right to left, so the track snakes.
 * @param {number} h  Hole number: 0 is the start, `target` the finish.
 * @param {number} lane  The player's lane (their seat index).
 * @returns {{x: number, y: number}} The hole's position in SVG units.
 * Side effects: none.
 */
function hole(h, lane) {
  const row = h === 0 ? 0 : Math.min(rows.value - 1, Math.floor((h - 1) / 30));
  const j = h - 30 * row;
  const x = h === 0 ? 0 : row % 2 === 0 ? j : 31 - j;
  return { x: PAD + x * STEP, y: PAD + row * rowHeight.value + lane * LANE };
}

// Every hole of every lane, with its position and whether it is drawn bigger (every fifth) or marked (start, skunk line, finish).
const holes = computed(() => {
  const out = [];
  for (let lane = 0; lane < laneCount.value; lane++) {
    for (let h = 0; h <= props.target; h++) {
      const { x, y } = hole(h, lane);
      out.push({ key: `${lane}-${h}`, x, y, lane, big: h % 5 === 0, mark: h === props.skunkLine || h === props.target || h === 0 });
    }
  }
  return out;
});

// The number labels printed above the track at every tenth hole (and the finish).
const markers = computed(() => {
  const out = [];
  for (let h = 5; h <= props.target; h += 5) {
    if (h % 10 !== 0 && h !== props.target) continue;
    const { x, y } = hole(h, 0);
    out.push({ h, x, y: y - 5.5 });
  }
  return out;
});

// The two pegs per player: the back peg (faded) and the front peg, positioned on their holes.
const pegs = computed(() =>
  props.seats.flatMap((s) => [
    { key: `b${s.seat}`, back: true, seat: s.seat, ...hole(s.back, s.seat) },
    { key: `f${s.seat}`, back: false, seat: s.seat, ...hole(s.score, s.seat) },
  ]),
);
// Text summary of the scores, for the board's accessible label.
const label = computed(() => t('board.label', { target: props.target, scores: list(props.seats.map((s) => t('board.score', { name: s.name, score: s.score }))) }));
</script>

<template>
  <svg class="board" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="label">
    <rect x="1" y="1" :width="width - 2" :height="height - 2" rx="8" class="wood" />
    <text v-for="m in markers" :key="m.h" :x="m.x" :y="m.y" class="num">{{ m.h }}</text>
    <circle
      v-for="h in holes"
      :key="h.key"
      :cx="h.x"
      :cy="h.y"
      :r="h.mark ? 3.5 : h.big ? 3.1 : 2.5"
      class="hole"
      :class="{ mark: h.mark }"
      :style="{ stroke: seatColour(h.lane) }"
    />
    <g v-for="p in pegs" :key="p.key" class="peg" :class="{ back: p.back }" :style="{ transform: `translate(${p.x}px, ${p.y}px)` }">
      <circle :r="p.back ? 4 : 4.8" :fill="seatColour(p.seat)" :opacity="p.back ? 0.55 : 1" class="knob" :class="{ mine: p.seat === you && !p.back }" />
    </g>
  </svg>
</template>

<style scoped>
.board {
  display: block;
  width: 100%;
  max-width: 560px;
  max-height: 100%; /* in a box of its own (the table) the whole board is shown at the size that fits */
  margin: 0 auto;
}
.wood {
  fill: #3a2a1c;
  stroke: #6a4f33;
  stroke-width: 1.5;
}
.hole {
  fill: #1b120b;
  stroke-width: 0.8;
  stroke-opacity: 0.45;
}
.hole.mark {
  stroke-opacity: 1;
}
.num {
  fill: #b9a283;
  font-size: 6.5px;
  text-anchor: middle;
}
.peg {
  transition: transform 0.6s ease;
}
.knob {
  stroke: #1b120b;
  stroke-width: 1;
}
.knob.mine {
  stroke: #fff;
  stroke-width: 1.4;
}
</style>
