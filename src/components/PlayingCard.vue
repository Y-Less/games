<script setup>
// A playing card drawn in CSS. `card` is a string such as "QS" (see shared/cards.js); pass null for a face-down card,
// which shows the viewer's chosen card back. With `clickable` it is a button and emits `pick`.
import { computed } from 'vue';
import { cardName, isJoker, isRed, rankOf, SUIT_SYMBOLS, suitOf } from '../../shared/cards.js';

const props = defineProps({
  card: { type: String, default: null },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg'
  clickable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
  trump: { type: Boolean, default: false }, // a trump: the white of the face is the light trump blue
});
defineEmits(['pick']);

const label = computed(() => (props.card ? cardName(props.card) : 'face-down card'));
const joker = computed(() => Boolean(props.card && isJoker(props.card)));
const rank = computed(() => (!props.card ? '' : joker.value ? '★' : rankOf(props.card)));
const symbol = computed(() => (!props.card || joker.value ? '' : SUIT_SYMBOLS[suitOf(props.card)]));
const red = computed(() => props.card && isRed(props.card));
const tag = computed(() => (props.clickable ? 'button' : 'div'));
</script>

<template>
  <component
    :is="tag"
    class="playing-card"
    :class="[size, { face: card, 'card-back': !card, red, joker, selected, dimmed, clickable, trump }]"
    :type="clickable ? 'button' : undefined"
    :disabled="clickable ? disabled : undefined"
    :aria-label="label"
    :aria-pressed="clickable ? selected : undefined"
    @click="clickable && !disabled && $emit('pick', card)"
  >
    <template v-if="card">
      <span class="corner top"><b>{{ rank }}</b><i>{{ symbol }}</i></span>
      <span class="pip">{{ joker ? '★' : symbol }}</span>
      <span v-if="joker" class="joker-label" aria-hidden="true">JOKER</span>
      <span class="corner bottom"><b>{{ rank }}</b><i>{{ symbol }}</i></span>
    </template>
  </component>
</template>

<style scoped>
.playing-card {
  --w: 4.4rem;
  position: relative;
  display: inline-block;
  width: var(--w);
  aspect-ratio: 5 / 7;
  padding: 0;
  border-radius: calc(var(--w) * 0.12);
  flex: none;
  transition: transform 0.12s, box-shadow 0.12s;
}
.playing-card.sm {
  --w: 3rem;
}
.playing-card.lg {
  --w: 5.8rem;
}
.playing-card.face,
.playing-card.face:hover:not(:disabled) {
  background: #fbf8f0;
  color: #1c1c1f;
  border: 1px solid #b9b2a2;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  font-family: var(--body);
}
.playing-card.face.trump,
.playing-card.face.trump:hover:not(:disabled) {
  background: var(--trump, #8fd3f0);
  border-color: #5a9fbd;
}
.playing-card.face.red,
.playing-card.face.red:hover:not(:disabled) {
  color: #b4281f; /* hovering must not turn a red card black */
}
.corner {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
  font-size: calc(var(--w) * 0.27);
}
.corner b {
  font-weight: 700;
}
.corner i {
  font-style: normal;
  font-size: 0.9em;
}
.corner.top {
  top: 6%;
  left: 7%;
}
.corner.bottom {
  bottom: 6%;
  right: 7%;
  transform: rotate(180deg);
}
.pip {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: calc(var(--w) * 0.62);
  line-height: 1;
  pointer-events: none;
}
.joker-label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 17%;
  text-align: center;
  font-size: calc(var(--w) * 0.14);
  font-weight: 700;
  letter-spacing: 0.1em;
  pointer-events: none;
}
.clickable {
  cursor: pointer;
  font: inherit;
}
.clickable:hover:not(:disabled) {
  transform: translateY(-6px);
}
.selected {
  transform: translateY(-12px);
  box-shadow: 0 0 0 3px var(--amber), 0 4px 10px rgb(0 0 0 / 0.5);
}
.dimmed,
.clickable:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
