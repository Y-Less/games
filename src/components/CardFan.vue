<script setup>
// A row of cards fanned out in an arc, each turned about a pivot far below the row: your hand, or an opponent's
// face-down cards. The box has a fixed size for `max` cards, so as cards leave the fan the box never shrinks; only the
// cards move (by transform). Each item is drawn by the default slot ({ item, index }), so the caller decides what a
// card is (a button, a face-down card...). `flip` turns the whole fan upside down, for the far side of the table.
import { computed } from 'vue';

const props = defineProps({
  items: { type: Array, required: true },
  itemKey: { type: Function, default: (item, i) => i },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg', as PlayingCard
  max: { type: Number, default: 13 }, // the most cards it ever holds: sets the size of the box
  step: { type: Number, default: 3.6 }, // degrees between neighbouring cards
  reach: { type: Number, default: 8 }, // distance of the pivot below the cards, in card widths
  flip: { type: Boolean, default: false },
});

const width = computed(() => ({ sm: 3, md: 4.4, lg: 5.8 })[props.size]);
const maxAngle = computed(() => ((props.max - 1) / 2) * props.step);
const cards = computed(() => props.items.map((item, i) => ({ item, i, key: props.itemKey(item, i), angle: Number(((i - (props.items.length - 1) / 2) * props.step).toFixed(2)) })));
</script>

<template>
  <div class="fan" :class="[size, { flip }]" :style="{ '--w': `${width}rem`, '--reach': `${width * reach}rem`, '--max': `${maxAngle}deg` }">
    <div v-for="c in cards" :key="c.key" class="fan-card" :style="{ '--angle': `${c.angle}deg`, zIndex: c.i + 1 }">
      <slot :item="c.item" :index="c.i" />
    </div>
  </div>
</template>

<style scoped>
.fan {
  --h: calc(var(--w) * 1.4);
  --lift: 1.4rem; /* room above the cards for the hovered or selected one to rise */
  position: relative;
  flex: none;
  width: calc(var(--reach) * 2 * sin(var(--max)) + var(--w) + 0.6rem);
  height: calc(var(--h) + var(--reach) * (1 - cos(var(--max))) + var(--lift));
}
.fan.flip {
  transform: rotate(180deg);
}
.fan-card {
  position: absolute;
  left: 50%;
  top: var(--lift);
  width: var(--w);
  height: var(--h);
  margin-left: calc(var(--w) / -2);
  transform-origin: 50% calc(var(--h) / 2 + var(--reach));
  transform: rotate(var(--angle));
  border-radius: calc(var(--w) * 0.12);
}
.fan-card:hover,
.fan-card:has(.selected) {
  z-index: 50 !important;
}
</style>
