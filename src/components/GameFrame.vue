<script setup>
// The standard shape of a game screen, so every game looks and behaves alike:
//
//   +------------------------------------------+
//   |  scorebar   (the score chips)             |
//   |  main       (the table: fills the rest)   |
//   |  others     (slim bars, optional)         |
//   |  log (Recent moves) |  status (Status)    |
//   +------------------------------------------+
//
// The frame is exactly as tall as the room under the site header, so the page never scrolls, and it is sized from the
// window alone, never from the game: nothing grows or shrinks during play. It draws no panel over the player's chosen
// background; only the two bottom boxes have (translucent) backgrounds of their own. Slots: scorebar, main, others,
// log, status. The `main` and `others` slots are given the size of its area ({ width, height } in pixels) so a game can size its
// pieces to fit it. The root carries data-fits-window, which tells the play view not to scale the game down.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  // The frame is a grid of 12 equal columns (--cols). Each row picks its own split on that grid, so the outer edges
  // and the gutters line up in every row while the splits may differ.
  mainSpan: { type: Number, default: 7 }, // columns taken by the left part of the main area (the rest go to the right part)
  logSpan: { type: Number, default: 6 }, // columns taken by the Recent moves box (the rest go to Status)
  logTitle: { type: String, default: 'Recent moves' },
  statusTitle: { type: String, default: 'Status' },
});

const root = ref(null);
const mainBox = ref(null);
const frameHeight = ref(Math.max(420, window.innerHeight - 110)); // a first guess, then measured
const frameWidth = ref(Math.min(1760, window.innerWidth - 32));
const area = ref({ width: frameWidth.value, height: Math.round(frameHeight.value * 0.5) });

function measure() {
  const el = root.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  frameHeight.value = Math.max(420, Math.floor(window.innerHeight - top - 14));
  frameWidth.value = Math.min(1760, window.innerWidth - 32);
}
let observer = null;
function measureMain() {
  const box = mainBox.value;
  if (box) area.value = { width: Math.floor(box.clientWidth), height: Math.floor(box.clientHeight) };
}
onMounted(() => {
  measure();
  window.addEventListener('resize', measure);
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measureMain);
    if (mainBox.value) observer.observe(mainBox.value);
  }
  nextTick(() => {
    measureMain();
    // Tell the page shell (which scales tall games down) that this screen fits by itself.
    window.dispatchEvent(new Event('resize'));
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure);
  observer?.disconnect();
});

const COLUMNS = 12;
const COLUMN_GAP = 12; // px: the one gutter between columns, in every row
const style = computed(() => ({
  height: `${frameHeight.value}px`,
  width: `${frameWidth.value}px`,
  '--gap': `${COLUMN_GAP}px`,
  '--cols': COLUMNS,
  '--log-span': props.logSpan,
}));
// Pixel widths of the two columns, for games that size drawings from them.
const columns = computed(() => {
  const unit = (area.value.width - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS;
  const span = (n) => Math.round(unit * n + COLUMN_GAP * (n - 1));
  return { left: span(props.mainSpan), right: span(COLUMNS - props.mainSpan), gap: COLUMN_GAP, mainSpan: props.mainSpan, columns: COLUMNS };
});
defineExpose({ measure });
</script>

<template>
  <div ref="root" class="game-frame" :class="{ 'no-others': !$slots.others }" data-fits-window :style="style">
    <div class="scorebar"><slot name="scorebar" /></div>
    <div ref="mainBox" class="main"><slot name="main" :width="area.width" :height="area.height" :left="columns.left" :right="columns.right" :gap="columns.gap" :main-span="columns.mainSpan" :columns="columns.columns" /></div>
    <div v-if="$slots.others" class="others"><slot name="others" :width="area.width" :height="area.height" :left="columns.left" :right="columns.right" :gap="columns.gap" :main-span="columns.mainSpan" :columns="columns.columns" /></div>
    <div class="bottom">
      <section class="box log" :aria-label="logTitle">
        <h3>{{ logTitle }}</h3>
        <div class="body"><slot name="log" /></div>
      </section>
      <section class="box status" :aria-label="statusTitle">
        <h3>{{ statusTitle }}</h3>
        <div class="body"><slot name="status" /></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.game-frame {
  /* Centred in the window however wide the site's own column is. */
  margin-left: calc(50% - min(50vw - 1rem, 880px));
  display: grid;
  grid-template-columns: repeat(var(--cols, 12), minmax(0, 1fr));
  grid-template-rows: auto minmax(0, 1fr) auto clamp(6.5rem, 22%, 13rem);
  /* Every row spans the same outer left and right edges, with the same gutters (--gap between columns, row-gap
     between rows). Each row may split its width differently: the main area uses `split`, the bottom boxes halve it. */
  column-gap: var(--gap, 12px);
  row-gap: 0.5rem;
  min-width: 0;
  overflow: visible;
}
/* A game with no bars (no `others` slot) has three rows, with the boxes in the last, which keeps its fixed height. */
.game-frame.no-others {
  grid-template-rows: auto minmax(0, 1fr) clamp(6.5rem, 22%, 13rem);
}
.game-frame > * {
  grid-column: 1 / -1;
  min-width: 0;
  min-height: 0;
}
.main {
  display: grid;
  grid-template-columns: subgrid; /* the same columns as the frame */
}
.bottom {
  display: grid;
  grid-template-columns: subgrid;
}
.box.log {
  grid-column: span var(--log-span, 6);
}
.box.status {
  grid-column: span calc(var(--cols, 12) - var(--log-span, 6));
}
.main {
  position: relative;
}
.main > :deep(*) {
  min-width: 0;
}
.others {
  position: relative;
  z-index: 5; /* anything that pops up from the bars sits over the main area */
}

.box {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.5rem 0.8rem 0.6rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 0.9rem;
  --log-height: 100%; /* GameLog fills the box and scrolls inside it */
}
.box h3 {
  flex: none;
  margin-bottom: 0.25rem;
  font-size: 0.95rem;
  color: var(--amber);
}
.body {
  flex: 1;
  min-height: 0;
}
</style>
