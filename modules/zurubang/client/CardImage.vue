<script setup>
// One Zurubang card: its face if this player may see it, and its back if they may not.  The art is served from the
// module itself (/assets/zurubang/cards), so there is nothing to draw here but a picture and whatever the table has
// asked to be said about it.
//
// Props:
//   card       {Object|null}  { id, back } for a face, { back } for a card seen from behind, null for an empty place.
//   width      {Number}       how wide to draw it, in pixels; the height follows the art's 3:5.
//   clickable  {Boolean}      draw it as a button and emit `pick` when it is used.
//   selected   {Boolean}      the player has this one in hand, so to speak.
//   dimmed     {Boolean}      it is on the table but out of the reckoning (a card out of a sudden death).
//   highlight  {Boolean}      the fight happening right now is this card's.
// Emits: pick.  Slots: none.  Side effects: none.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  card: { type: Object, default: null },
  width: { type: Number, default: 92 },
  clickable: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
  highlight: { type: Boolean, default: false },
});
defineEmits(['pick']);
const { t } = useGameText();

/** The art is 3:5, and every place on the table is drawn to that shape whether or not it holds a card. */
const height = computed(() => Math.round((props.width * 5) / 3));
const source = computed(() => (props.card?.id ? `/assets/zurubang/cards/faces/${props.card.id}.jpg` : props.card?.back ? `/assets/zurubang/cards/backs/${props.card.back}.jpg` : null));
/** What a screen reader is told: the card's name if it is face up, and the element its back promises if it is not. */
const label = computed(() => (props.card?.id ? t(`cards.${props.card.id}`) : props.card?.back ? t(`table.back.${props.card.back}`) : t('table.emptyPlace')));
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="zb-card"
    :class="{ selected, dimmed, highlight, empty: !source, clickable }"
    :style="{ width: `${width}px`, height: `${height}px` }"
    :type="clickable ? 'button' : undefined"
    :aria-pressed="clickable ? selected : undefined"
    :aria-label="clickable ? label : undefined"
    @click="clickable && $emit('pick')"
  >
    <img v-if="source" :src="source" :alt="label" :width="width" :height="height" draggable="false" />
    <span v-else class="muted" aria-hidden="true"></span>
  </component>
</template>

<style scoped>
.zb-card {
  display: block;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 8px;
  background: var(--bg-raised, #2a2a2a);
  overflow: hidden;
  flex: none;
  line-height: 0;
}
.zb-card img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
}
.zb-card.empty {
  border-style: dashed;
  border-color: var(--muted, #888);
  opacity: 0.35;
}
.zb-card.clickable {
  cursor: pointer;
  transition:
    transform 0.12s ease,
    border-color 0.12s ease;
}
.zb-card.clickable:hover,
.zb-card.clickable:focus-visible {
  transform: translateY(-4px);
  border-color: var(--amber, #e0a030);
}
.zb-card.selected {
  border-color: var(--amber, #e0a030);
  transform: translateY(-8px);
}
.zb-card.highlight {
  border-color: var(--amber, #e0a030);
  box-shadow: 0 0 10px var(--amber, #e0a030);
}
.zb-card.dimmed {
  opacity: 0.4;
  filter: grayscale(0.7);
}
</style>
