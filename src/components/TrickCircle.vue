<script setup>
// The trick being played, laid out in a circle: one permanent slot per seat, the viewer's at the bottom and the others
// clockwise round from there. The slots are always there (empty ones are drawn as faint outlines), and the circle has
// a fixed size for its card size, so a card landing in the trick never moves or resizes anything.
// `seats` is [{ key, name }] viewer first; `plays` is [{ key, card }]; `winnerKey` outlines the winning card.
// Pass `labels` to print each seat's name under its slot. The default slot is laid over the middle (for messages).
import { computed } from 'vue';
import PlayingCard from './PlayingCard.vue';

const props = defineProps({
  seats: { type: Array, required: true },
  plays: { type: Array, default: () => [] },
  winnerKey: { type: [String, Number], default: null },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg', as PlayingCard
  labels: { type: Boolean, default: false },
});

const slots = computed(() =>
  props.seats.map((seat, i) => {
    const angle = (2 * Math.PI * i) / props.seats.length;
    // -sin puts the next seat clockwise on the viewer's left, as at a real table.
    return { seat, sx: Number((-Math.sin(angle)).toFixed(4)), sy: Number(Math.cos(angle).toFixed(4)), card: props.plays.find((p) => p.key === seat.key)?.card ?? null };
  }),
);
</script>

<template>
  <div class="trick-circle" :class="size" role="group" aria-label="The trick" aria-live="polite">
    <div v-for="slot in slots" :key="slot.seat.key" class="slot" :class="{ won: slot.seat.key === winnerKey && slot.card }" :style="{ '--sx': slot.sx, '--sy': slot.sy }">
      <PlayingCard v-if="slot.card" :card="slot.card" :size="size" />
      <span v-else class="empty" aria-hidden="true" />
      <span v-if="labels" class="who">{{ slot.seat.name }}</span>
    </div>
    <div class="middle"><slot /></div>
  </div>
</template>

<style scoped>
.trick-circle {
  --w: 4.4rem;
  --h: calc(var(--w) * 1.4);
  --rx: calc(var(--w) * 1.3);
  --ry: calc(var(--h) * 0.75);
  position: relative;
  flex: none;
  width: calc(var(--rx) * 2 + var(--w) + 2rem);
  height: calc(var(--ry) * 2 + var(--h) + 1.2rem);
}
.trick-circle.sm {
  --w: 3rem;
}
.trick-circle.lg {
  --w: 5.8rem;
}
.slot {
  position: absolute;
  left: calc(50% + var(--sx) * var(--rx));
  top: calc(50% + var(--sy) * var(--ry));
  width: var(--w);
  height: var(--h);
  transform: translate(-50%, -50%);
}
.empty {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 2px dashed var(--line);
  border-radius: calc(var(--w) * 0.12);
  opacity: 0.5;
}
.slot.won :deep(.playing-card) {
  box-shadow: 0 0 0 3px var(--amber), 0 4px 10px rgb(0 0 0 / 0.5);
}
.who {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(var(--w) * 1.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  color: var(--muted);
}
.slot.won .who {
  color: var(--amber);
}
.middle {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  text-align: center;
}
.middle :deep(p) {
  margin: 0;
}
</style>
