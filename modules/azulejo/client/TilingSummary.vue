<script setup>
// What the wall-tiling phase of the last round did, for every player: each tile placed and what it scored, the
// floor penalty, and the new score. Nothing is hidden: this is the same information the walls now show.
//
// Props:
//   tiling  {Object}  required. lastTiling from the view: { round, players: [{ seat, placed, dropped, penalty, lost, before, after }] }.
//   seats   {Array}   required. Seat records (for names), indexed by seat number.
//   you     {number}  the viewer's seat, to highlight their row (default -1: nobody).
// Emits: none. Slots: none.
// Side effects: none (pure rendering).
import { useGameText } from '../../../src/useGameText.js';
import Tile from './Tile.vue';

defineProps({
  tiling: { type: Object, required: true }, // lastTiling from the view
  seats: { type: Array, required: true },
  you: { type: Number, default: -1 },
});
const { t } = useGameText();
</script>

<template>
  <div class="summary" role="group" :aria-label="t('tiling.label', { n: tiling.round })">
    <h4>{{ t('tiling.title', { n: tiling.round }) }}</h4>
    <ul>
      <li v-for="p in tiling.players" :key="p.seat" :class="{ me: p.seat === you }">
        <strong class="name">{{ seats[p.seat]?.name }}</strong>
        <span class="placed">
          <span v-for="tile in p.placed" :key="tile.row" class="chip" :title="t('tiling.chip', { row: tile.row + 1, count: tile.points }, tile.points)">
            <Tile :colour="tile.colour" :size="20" /><b>+{{ tile.points }}</b>
          </span>
          <span v-if="!p.placed.length" class="muted">{{ t('tiling.noneFull') }}</span>
          <span v-if="p.dropped.length" class="muted">{{ t('tiling.dropped', { count: p.dropped.length }, p.dropped.length) }}</span>
        </span>
        <span class="floor" :class="{ none: !p.penalty }">{{ p.penalty ? t('tiling.floorLost', { lost: p.lost }) : t('tiling.floorNone') }}</span>
        <span class="after">{{ p.before }} → <strong>{{ p.after }}</strong></span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
h4 {
  margin: 0 0 0.3rem;
  font-family: var(--display);
  font-size: 0.95rem;
  color: var(--amber);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
li {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 0.5rem;
  border-radius: 8px;
  background: rgb(0 0 0 / 0.16);
  font-size: 0.88rem;
}
li.me {
  outline: 1px solid var(--amber);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.placed {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0 0.3rem 0 0.1rem;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.06);
}
.floor {
  color: var(--danger);
}
.floor.none {
  color: var(--muted);
}
.after {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
