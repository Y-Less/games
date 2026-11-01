<script setup>
// The big dial, in the left columns of the table (or all of them on a narrow screen).
// Props: state (the server view: spectrum, target, bands), markers (pins to draw), needle (where your needle or the team's
//   marker is), colour (the needle's colour), interactive (you may turn it), width (the dial's width in px), span (how many
//   frame columns it takes).
// Slots: none.
// Emits: pick(position) when the dial is turned.
// Side effects: none beyond the emit.
import Dial from './Dial.vue';

defineProps({
  state: { type: Object, required: true },
  markers: { type: Array, required: true },
  needle: { type: Number, default: null },
  colour: { type: String, required: true },
  interactive: { type: Boolean, default: false },
  width: { type: Number, required: true },
  span: { type: Number, required: true },
});
defineEmits(['pick']);
</script>

<template>
  <div class="dial-col" :style="{ gridColumn: `span ${span}` }">
    <Dial
      v-if="state.spectrum"
      :left="state.spectrum.left"
      :right="state.spectrum.right"
      :target="state.target"
      :bands="state.bands"
      :guesses="markers"
      :selected="needle"
      :colour="colour"
      :interactive="interactive"
      :width="width"
      @pick="$emit('pick', $event)"
    />
  </div>
</template>

<style scoped>
.dial-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
</style>
