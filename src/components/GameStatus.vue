<script setup>
// The content of every game's "Status" box: what is happening and what to do next. It fills the box it is put in (the
// box is a fixed size, see GameFrame) and scrolls inside itself, so more words never make the page grow.
//   headline   the one line that matters now ("Your turn: click a colour on a plate.", "Waiting for Isabel…")
//   mine       true when the headline is about you (your turn, something you must do): drawn in the accent colour, and a small
//              "It's your turn" pop-up (YourTurnPopup) appears when it becomes true, in every game
//   turn       what the pop-up follows when that is not the same as `mine`. Games in which everyone acts together, apart from one
//              special chooser (Dixnt, Tints and Hints, Wavelength), set it true only for the chooser's own turn to choose, so
//              that the others, who all go at once, get no pop-up. Leave it out and the pop-up follows `mine`.
//   popup      false to leave that pop-up out (default true)
//   lines      further lines: a string, or { text, tone } with tone 'mine' | 'muted' | 'warn'
// The `facts` slot is the persistent line of game-state facts shown above the headline (round or turn number, bag or
// deck counts, target score ...): those belong here, never in the main area. The default slot adds anything else (small icons, a button) below the lines.
import YourTurnPopup from './YourTurnPopup.vue';

defineProps({
  headline: { type: String, default: '' },
  mine: { type: Boolean, default: false },
  turn: { type: Boolean, default: null },
  popup: { type: Boolean, default: true },
  lines: { type: Array, default: () => [] },
});
const lineOf = (line) => (typeof line === 'string' ? { text: line, tone: '' } : { tone: '', ...line });
</script>

<template>
  <div class="game-status">
    <div v-if="$slots.facts" class="facts"><slot name="facts" /></div>
    <p v-if="headline" class="headline" :class="{ mine }" role="status">{{ headline }}</p>
    <p v-for="(line, i) in lines" :key="i" class="line" :class="lineOf(line).tone">{{ lineOf(line).text }}</p>
    <slot />
    <YourTurnPopup v-if="popup" :active="turn ?? mine" />
  </div>
</template>

<style scoped>
.game-status {
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.game-status > * {
  flex: none;
}
p {
  margin: 0;
}
.facts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.2rem 0.9rem;
  font-size: 0.85rem;
  color: var(--muted);
}
.headline {
  font-family: var(--display);
  font-size: 1.05rem;
  color: var(--parchment);
}
.headline.mine,
.line.mine {
  color: var(--amber);
}
.line {
  font-size: 0.9rem;
}
.line.muted {
  color: var(--muted);
}
.line.warn {
  color: var(--danger);
}
</style>
