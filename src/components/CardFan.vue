<script setup>
// File: a fanned (or flat) row of cards.  Depends on: Vue only.
// Props: items (Array, required), itemKey (Function (item, i) => key), size ('sm'|'md'|'lg'), max (Number, sizes the box),
//   step (Number, degrees between cards), reach (Number, pivot distance in card widths), flip, straight (Boolean), overlap (Number).
// Emits: none.  Slots: default (scoped { item, index }, draws one card).
// Side effects: none.
// A row of cards fanned out in an arc, each turned about a pivot far below the row: your hand, or an opponent's
// face-down cards.  The box has a fixed size for `max` cards, so as cards leave the fan the box never shrinks; only the
// cards move (by transform).  Each item is drawn by the default slot ({ item, index }), so the caller decides what a
// card is (a button, a face-down card...). `flip` turns the whole fan upside down, for the far side of the table.
// With `straight` the cards are not fanned but laid in a flat row, each overlapping the last so that `overlap` (a share
// of a card's width) of every card shows; the box is then only as tall as one card, which takes the least room.
import { computed } from 'vue';

const props = defineProps({
  items: { type: Array, required: true },
  itemKey: { type: Function, default: (item, i) => i },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg', as PlayingCard
  max: { type: Number, default: 13 }, // the most cards it ever holds: sets the size of the box
  step: { type: Number, default: 3.6 }, // degrees between neighbouring cards
  reach: { type: Number, default: 8 }, // distance of the pivot below the cards, in card widths
  flip: { type: Boolean, default: false },
  straight: { type: Boolean, default: false },
  overlap: { type: Number, default: 0.48 },
});

// Width of one card in rem for the chosen size (matches PlayingCard's sizes).
const width = computed(() => ({ sm: 3, md: 4.4, lg: 5.8 })[props.size]);
// Angle in degrees of the outermost card of a full fan (`max` cards); used to size the box so it never shrinks.
const maxAngle = computed(() => ((props.max - 1) / 2) * props.step);
// Returns the horizontal shift in rem of card `i` from the centre when the fan is laid straight, so the row stays centred.
const offset = (i) => Number(((i - (props.items.length - 1) / 2) * props.overlap * width.value).toFixed(3));
// Each item with its key, fan angle (degrees), and straight-row x offset (rem), ready for the template.
const cards = computed(() => props.items.map((item, i) => ({ item, i, key: props.itemKey(item, i), angle: props.straight ? 0 : Number(((i - (props.items.length - 1) / 2) * props.step).toFixed(2)), x: props.straight ? offset(i) : 0 })));
// Fixed width of the box in straight mode (null in fan mode, where the stylesheet sizes it from the angle).
const boxWidth = computed(() => (props.straight ? `${(props.max - 1) * props.overlap * width.value + width.value + 0.6}rem` : null));
</script>

<template>
  <div class="fan" :class="[size, { flip, straight }]" :style="{ '--w': `${width}rem`, '--reach': `${width * reach}rem`, '--max': `${maxAngle}deg`, ...(boxWidth ? { width: boxWidth } : {}) }">
    <div v-for="c in cards" :key="c.key" class="fan-card" :style="{ '--angle': `${c.angle}deg`, '--x': `${c.x}rem`, zIndex: c.i + 1 }">
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
.fan.straight {
  height: calc(var(--h) + var(--lift));
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
  transform: translateX(var(--x, 0)) rotate(var(--angle));
  border-radius: calc(var(--w) * 0.12);
}
.fan.straight .fan-card {
  transform-origin: 50% 50%;
}
/* A hovered or selected card only rises (PlayingCard); it keeps its own place in the stacking order, so it never
   covers its neighbours. */
</style>
