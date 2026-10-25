<script setup>
// The trick being played: one permanent slot per seat (the viewer's at the bottom, the others clockwise round from
// there), the played cards lying on top of each other at jaunty angles, each pushed a little towards its player's side.
// The angle is worked out from the seat and the card, so it is the same on every render. The area has a fixed size for
// its card size whether it holds no cards or all of them, so a card landing never moves or resizes anything: cards are
// placed with transforms only.
// `seats` is [{ key, name }] viewer first; `plays` is [{ key, card }] in the order played; `winnerKey` outlines the
// winning card. `labels` prints each player's name on their card. The default slot is laid over the middle (messages).
import { computed } from 'vue';
import PlayingCard from './PlayingCard.vue';

const props = defineProps({
  seats: { type: Array, required: true },
  plays: { type: Array, default: () => [] },
  winnerKey: { type: [String, Number], default: null },
  size: { type: String, default: 'lg' }, // 'sm' | 'md' | 'lg', as PlayingCard
  labels: { type: Boolean, default: false },
});

/** A small stable number from a string: the same card from the same seat always sits at the same angle. */
function hash(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

const slots = computed(() =>
  props.seats.map((seat, i) => {
    const angle = (2 * Math.PI * i) / props.seats.length;
    // -sin puts the next seat clockwise on the viewer's left, as at a real table.
    const sx = Number((-Math.sin(angle)).toFixed(4));
    const sy = Number(Math.cos(angle).toFixed(4));
    const order = props.plays.findIndex((p) => p.key === seat.key);
    const card = order >= 0 ? props.plays[order].card : null;
    const turn = 12 * sx + 6 * sy + (card ? (hash(`${seat.key}${card}`) % 11) - 5 : 0);
    return { seat, sx, sy, card, order, turn: Number(turn.toFixed(1)) };
  }),
);
</script>

<template>
  <div class="trick-circle" :class="size" role="group" aria-label="The trick" aria-live="polite">
    <div
      v-for="slot in slots"
      :key="slot.seat.key"
      class="slot"
      :class="{ won: slot.card && slot.seat.key === winnerKey, filled: slot.card }"
      :style="{ '--sx': slot.sx, '--sy': slot.sy, '--turn': `${slot.turn}deg`, zIndex: slot.order + 1 }"
    >
      <PlayingCard v-if="slot.card" :card="slot.card" :size="size" />
      <span v-if="labels && slot.card" class="who">{{ slot.seat.name }}</span>
    </div>
    <div class="middle"><slot /></div>
  </div>
</template>

<style scoped>
.trick-circle {
  --w: 4.4rem;
  --h: calc(var(--w) * 1.4);
  position: relative;
  flex: none;
  width: calc(var(--w) * 2.8);
  height: calc(var(--h) * 1.8);
}
.trick-circle.sm {
  --w: 3rem;
}
.trick-circle.lg {
  --w: 5.8rem;
}
.slot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--w);
  height: var(--h);
  transform: translate(-50%, -50%) translate(calc(var(--sx) * var(--w) * 0.42), calc(var(--sy) * var(--h) * 0.27)) rotate(var(--turn));
  pointer-events: none;
}
.slot.won :deep(.playing-card) {
  box-shadow: 0 0 0 3px var(--amber), 0 4px 10px rgb(0 0 0 / 0.5);
}
.slot :deep(.playing-card) {
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.55);
}
.who {
  position: absolute;
  left: 50%;
  bottom: 4%;
  transform: translateX(-50%);
  max-width: 96%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 0.3rem;
  border-radius: 99px;
  background: rgb(0 0 0 / 0.65);
  color: var(--parchment, #fff);
  font-size: 0.68rem;
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
