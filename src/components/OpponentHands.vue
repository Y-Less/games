<script setup>
// The opponents' face-down hands, with their names, around the edges of a card table. Every card game shows these, laid
// out by how many opponents there are (in clockwise order from you: the player after you first):
//
//   1: top centre            4: 2 left, 2 right
//   2: left, right           5: 2 left, top centre, 2 right
//   3: left, top, right      6: 2 left, 2 top, 2 right
//
// Put it inside the table's `position: relative` area; it fills that area and never takes clicks. Each opponent is
// { key, name, cards, note?, away?, current? } (`note` is a short line under the name, `current` marks whose turn it
// is). `max` is the most cards a hand ever holds: the fan's box is that size, so nothing moves as cards are played.
// The whole thing is scaled to the room, so the same layout fits any desktop window. Side hands are turned on their sides.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CardFan from './CardFan.vue';
import PlayingCard from './PlayingCard.vue';
import { MAX_OPPONENTS, OPPONENT_LAYOUTS } from '../opponentLayouts.js';

const props = defineProps({
  opponents: { type: Array, required: true },
  max: { type: Number, default: 13 },
});

// Sizes, in rem, of one hand drawn at scale 1 (small cards in a fan, then the name under it).
const CARD = 3;
const STEP = 4;
const REACH = 6 * CARD;
const LABEL = 2.6;
const GAP = 0.8;
const PAD = 0; // hands sit right on the edges of the table
const rad = (deg) => (deg * Math.PI) / 180;
const fan = computed(() => {
  const angle = ((props.max - 1) / 2) * STEP;
  return { width: 2 * REACH * Math.sin(rad(angle)) + CARD + 0.6, height: CARD * 1.4 + REACH * (1 - Math.cos(rad(angle))) + 1.4 };
});
const block = computed(() => ({ width: fan.value.width, height: fan.value.height + LABEL }));

const root = ref(null);
const size = ref({ width: 1000, height: 560, rem: 16 });
let observer = null;
function measure() {
  const el = root.value;
  if (!el) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const width = el.clientWidth;
  const height = el.clientHeight;
  if (width && height) size.value = { width, height, rem };
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());

const layout = computed(() => {
  const n = Math.min(MAX_OPPONENTS, props.opponents.length);
  return OPPONENT_LAYOUTS[n] ?? { left: [], top: [], right: [] };
});

// One scale for every hand: from the height of the table, and small enough that the stacked side hands and the top row fit.
const scale = computed(() => {
  const { width, height, rem } = size.value;
  const w = width / rem;
  const h = height / rem;
  const { left, top, right } = layout.value;
  const sideCount = Math.max(left.length, right.length);
  let s = Math.max(0.5, Math.min(1.4, h / 34));
  if (sideCount) s = Math.min(s, (h - 2 * PAD) / (sideCount * block.value.width + (sideCount - 1) * GAP));
  if (top.length) s = Math.min(s, (w - 2 * (block.value.height + 2 * PAD)) / (top.length * block.value.width + (top.length - 1) * GAP));
  return Math.max(0.4, s);
});

const placed = computed(() => {
  const { width, height, rem } = size.value;
  const s = scale.value;
  const step = (block.value.width + GAP) * s * rem; // along a side or the top row, from one hand to the next
  const across = (block.value.height * s * rem) / 2; // half the depth of a hand, away from the edge
  const pad = PAD * rem;
  const out = [];
  const put = (index, side, cx, cy, rotate) => {
    const o = props.opponents[index];
    if (!o) return;
    out.push({
      ...o,
      side,
      style: {
        left: `${Math.round(cx)}px`,
        top: `${Math.round(cy)}px`,
        width: `${block.value.width}rem`,
        height: `${block.value.height}rem`,
        transform: `translate(-50%, -50%) rotate(${rotate}deg) scale(${s})`,
      },
    });
  };
  const { left, top, right } = layout.value;
  left.forEach((index, j) => put(index, 'left', pad + across, height / 2 - (j - (left.length - 1) / 2) * step, 90));
  top.forEach((index, j) => put(index, 'top', width / 2 + (j - (top.length - 1) / 2) * step, pad + across, 0));
  right.forEach((index, j) => put(index, 'right', width - pad - across, height / 2 + (j - (right.length - 1) / 2) * step, -90));
  return out;
});
</script>

<template>
  <div ref="root" class="opponent-hands">
    <div v-for="o in placed" :key="o.key" class="opp" :class="[o.side, { away: o.away, current: o.current }]" :style="o.style" role="group" :aria-label="`${o.name}: ${o.cards} ${o.cards === 1 ? 'card' : 'cards'}`">
      <CardFan class="opp-fan" :items="Array.from({ length: o.cards }, (_, n) => n)" size="sm" :step="STEP" :reach="6" :max="max" :flip="o.side === 'top'" :aria-label="`${o.cards} cards`">
        <template #default><PlayingCard :card="null" size="sm" /></template>
      </CardFan>
      <div class="label">
        <strong class="who">{{ o.name }}</strong>
        <span class="tag">{{ o.note }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.opponent-hands {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.opp {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: 12px;
}
.opp.away {
  opacity: 0.65;
}
.label {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 2.6rem;
  max-width: 100%;
  line-height: 1.3;
}
.who {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.05rem;
}
.opp.current .who {
  color: var(--amber);
}
.tag {
  min-height: 1.1rem;
  font-size: 0.8rem;
  color: var(--muted);
}
</style>
