<script setup>
// One player's board: pattern lines (a staircase, filling from the right), the wall with faint ghost tiles showing
// where each colour belongs, and the floor line with its penalties. Yours is clickable while you are placing tiles.
import { computed } from 'vue';
import { SIZE, wallColour } from '../rules.js';
import Tile from './Tile.vue';
import { PENALTY_LABEL } from './tiles.js';

const props = defineProps({
  seat: { type: Object, required: true }, // a seat from the view: { name, bot, online, score, lines, wall, floor, penalty }
  cell: { type: Number, default: 44 },
  isMe: { type: Boolean, default: false },
  current: { type: Boolean, default: false }, // it is this player's turn
  nextFirst: { type: Boolean, default: false }, // holds the first-player marker for the next round
  free: { type: Boolean, default: false }, // the free wall variant: no ghosts
  // While a colour group is selected: one entry per line, { ok: boolean, title: string }, and whether the floor is clickable.
  lineHints: { type: Array, default: null },
  floorOpen: { type: Boolean, default: false },
  floorTitle: { type: String, default: '' },
  choose: { type: Object, default: null }, // { row, colour, columns } while this player picks a wall column
  highlightRow: { type: Number, default: -1 },
  previewLine: { type: [Number, String], default: null },
});
const emit = defineEmits(['line', 'floor', 'column', 'hover']);

const rows = Array.from({ length: SIZE }, (_, i) => i);
const slotsOf = (i) => Array.from({ length: i + 1 }, (_, k) => k);
const filled = (i, k) => k >= i + 1 - props.seat.lines[i].count;
const hint = (i) => props.lineHints?.[i] ?? null;
const isChoice = (r, c) => props.choose?.row === r && props.choose.columns.includes(c);
const floorSlots = computed(() => Array.from({ length: 7 }, (_, i) => props.seat.floor?.[i] ?? null));
</script>

<template>
  <section class="board" :class="{ turn: current, mine: isMe, away: !seat.bot && !seat.online }" :style="{ '--t': `${cell}px` }" :aria-label="`${seat.name}'s board`">
    <header class="head">
      <strong class="who">{{ seat.name }}</strong>
      <span v-if="isMe" class="tag">you</span>
      <span v-if="seat.bot" class="tag bot">computer</span>
      <span v-else-if="!seat.online" class="tag away">away</span>
      <span v-if="current" class="tag turn-tag">to move</span>
      <span v-if="nextFirst" class="tag first" title="Starts the next round">first next round</span>
      <span class="score" :title="`${seat.name} has ${seat.score} points`">{{ seat.score }}</span>
    </header>

    <div class="grid">
      <div class="lines" role="group" aria-label="Pattern lines">
        <component
          :is="hint(i) ? 'button' : 'div'"
          v-for="i in rows"
          :key="i"
          class="line"
          :class="{
            ok: hint(i)?.ok,
            no: hint(i) && !hint(i).ok,
            preview: previewLine === i,
            full: seat.lines[i].count === i + 1,
          }"
          :type="hint(i) ? 'button' : undefined"
          :title="hint(i)?.title"
          :aria-disabled="hint(i) ? !hint(i).ok : undefined"
          :aria-label="`Line ${i + 1}: ${seat.lines[i].count} of ${i + 1} tiles`"
          @click="hint(i) && emit('line', i)"
          @mouseenter="hint(i) && emit('hover', i)"
          @mouseleave="hint(i) && emit('hover', null)"
          @focus="hint(i) && emit('hover', i)"
          @blur="hint(i) && emit('hover', null)"
        >
          <span v-for="p in 4 - i" :key="`pad${p}`" class="pad" />
          <span v-for="k in slotsOf(i)" :key="k" class="slot">
            <Tile v-if="filled(i, k)" :colour="seat.lines[i].colour" :size="cell - 6" />
          </span>
        </component>
      </div>

      <div class="wall" role="group" :aria-label="free ? 'Wall (free)' : 'Wall'" :class="{ choosing: Boolean(choose) }">
        <div v-for="r in rows" :key="r" class="wall-row" :class="{ marked: highlightRow === r }">
          <template v-for="c in rows" :key="c">
            <button v-if="isChoice(r, c)" type="button" class="spot choice" :aria-label="`Put the tile in row ${r + 1}, column ${c + 1}`" @click="emit('column', c)">
              <Tile :colour="choose.colour" :size="cell - 6" ghost />
            </button>
            <span v-else class="spot" :class="{ filled: seat.wall[r][c] !== null }">
              <Tile v-if="seat.wall[r][c] !== null" :colour="seat.wall[r][c]" :size="cell - 6" />
              <Tile v-else-if="!free" :colour="wallColour(r, c)" :size="cell - 6" ghost />
            </span>
          </template>
        </div>
      </div>
    </div>

    <component
      :is="floorOpen ? 'button' : 'div'"
      class="floor"
      :class="{ open: floorOpen, preview: previewLine === 'floor' }"
      :type="floorOpen ? 'button' : undefined"
      :title="floorOpen ? floorTitle : undefined"
      aria-label="Floor line"
      @click="floorOpen && emit('floor')"
      @mouseenter="floorOpen && emit('hover', 'floor')"
      @mouseleave="floorOpen && emit('hover', null)"
      @focus="floorOpen && emit('hover', 'floor')"
      @blur="floorOpen && emit('hover', null)"
    >
      <span class="floor-label">Floor</span>
      <span v-for="(slot, i) in floorSlots" :key="i" class="fslot">
        <span class="fbox"><Tile v-if="slot !== null" :colour="slot" :size="cell * 0.62" /></span>
        <span class="pen">{{ PENALTY_LABEL[i] }}</span>
      </span>
      <span class="floor-total" :class="{ none: !seat.penalty }">{{ seat.penalty ? `-${seat.penalty}` : '0' }}</span>
    </component>
  </section>
</template>

<style scoped>
.board {
  --t: 44px;
  background: color-mix(in srgb, var(--bg-sunken) 80%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.6rem 0.7rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.board.turn {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber), 0 0 14px rgb(224 168 74 / 0.25);
}
.board.away {
  opacity: 0.75;
}
.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.who {
  font-family: var(--display);
  font-size: 1.05rem;
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-size: 0.7rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.turn-tag {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
  font-weight: 650;
}
.tag.first {
  border-color: var(--amber);
  color: var(--amber);
}
.tag.away {
  color: var(--danger);
  border-color: var(--danger);
}
.score {
  margin-left: auto;
  font-family: var(--display);
  font-size: 1.5rem;
  line-height: 1;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}
.grid {
  display: flex;
  align-items: flex-start;
  gap: calc(var(--t) * 0.4);
}
.lines {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.line {
  display: flex;
  justify-content: flex-end;
  gap: 3px;
  padding: 0;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  transition: none;
  width: calc(var(--t) * 5 + 12px);
}
button.line {
  cursor: pointer;
  padding: 0;
}
.pad {
  width: var(--t);
  height: var(--t);
}
.slot {
  width: var(--t);
  height: var(--t);
  display: grid;
  place-items: center;
  border: 1.5px dashed var(--line);
  border-radius: 7px;
  background: rgb(0 0 0 / 0.18);
}
.line.ok {
  border-color: var(--moss);
  background: rgb(127 174 122 / 0.14);
}
.line.ok:hover,
.line.preview.ok {
  background: rgb(127 174 122 / 0.32);
}
.line.no {
  cursor: not-allowed;
  opacity: 0.45;
}
.line.preview .slot {
  border-color: var(--moss);
}
.wall {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wall-row {
  display: flex;
  gap: 3px;
}
.spot {
  width: var(--t);
  height: var(--t);
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: rgb(0 0 0 / 0.22);
  border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  padding: 0;
}
.spot.filled {
  background: rgb(0 0 0 / 0.1);
}
.wall.choosing .spot:not(.choice) {
  opacity: 0.55;
}
button.spot.choice {
  cursor: pointer;
  border: 2px solid var(--amber);
  background: rgb(224 168 74 / 0.22);
  animation: none;
}
button.spot.choice:hover {
  background: rgb(224 168 74 / 0.45);
}
.floor {
  display: flex;
  align-items: flex-start;
  gap: 3px;
  padding: 0.25rem 0.3rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgb(0 0 0 / 0.18);
  color: inherit;
  font: inherit;
  width: 100%;
  justify-content: flex-start;
  transition: none;
}
button.floor {
  cursor: pointer;
}
.floor.open {
  border-color: var(--moss);
  background: rgb(127 174 122 / 0.14);
}
.floor.open:hover,
.floor.preview {
  background: rgb(127 174 122 / 0.32);
}
.floor-label {
  align-self: center;
  font-size: 0.72rem;
  color: var(--muted);
  width: 2.2rem;
  text-align: left;
}
.fslot {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: calc(var(--t) * 0.72);
}
.fbox {
  width: calc(var(--t) * 0.68);
  height: calc(var(--t) * 0.68);
  display: grid;
  place-items: center;
  border: 1px dashed var(--line);
  border-radius: 6px;
}
.pen {
  font-size: 0.72rem;
  color: var(--danger);
  font-variant-numeric: tabular-nums;
}
.floor-total {
  margin-left: auto;
  align-self: center;
  font-family: var(--display);
  font-size: 1.05rem;
  color: var(--danger);
  padding-right: 0.2rem;
}
.floor-total.none {
  color: var(--muted);
}
</style>
