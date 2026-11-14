<script setup>
// The drawer's tools, for the games that draw (Scribblers, Draw!): the palette, the pen, the rubber, the paint bucket,
// the brush sizes, undo, and clear.  The two rows of colours are the palette the instructions name by place
// (shared/drawing.js), the bright ones above their darker twins.
// Depends on: src/drawBoard.js (the palette), src/useDrawingTools.js (the kinds of tool), and src/useGameText.js.
// Props: tool ({ kind, colour, width }, changed in place: see useDrawingTools), widths (the brush sizes offered, in
//   board units).
// Emits: undo, clear.  Slots: none.
// Side effects: none beyond changing the tool it was given.
import { PALETTE } from '../drawBoard.js';
import { TOOLS, WIDTHS } from '../useDrawingTools.js';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  tool: { type: Object, required: true },
  widths: { type: Array, default: () => WIDTHS },
});
defineEmits(['undo', 'clear']);
const { t } = useGameText();

// The palette in two rows, as the colours were meant to be shown: the bright ones above their darker twins.
const rows = [PALETTE.slice(0, 13), PALETTE.slice(13)];
/** What each kind of tool looks like on its button. */
const GLYPHS = { pen: '✏️', rubber: '🩹', fill: '🪣' };
</script>

<template>
  <div class="toolbox">
    <div class="colours" :aria-label="t('board.colours')" role="group">
      <div v-for="(row, r) in rows" :key="r" class="colour-row">
        <button
          v-for="(hex, n) in row"
          :key="hex"
          type="button"
          class="swatch"
          :class="{ picked: props.tool.colour === r * 13 + n && props.tool.kind !== 'rubber' }"
          :style="{ background: hex }"
          :title="t('board.colour', { n: r * 13 + n + 1 })"
          :aria-label="t('board.colour', { n: r * 13 + n + 1 })"
          :aria-pressed="props.tool.colour === r * 13 + n && props.tool.kind !== 'rubber'"
          @click="
            props.tool.colour = r * 13 + n;
            props.tool.kind = props.tool.kind === 'rubber' ? 'pen' : props.tool.kind;
          "
        />
      </div>
    </div>

    <div class="group" :aria-label="t('board.tools')" role="group">
      <button
        v-for="kind in TOOLS"
        :key="kind"
        type="button"
        class="tool"
        :class="{ picked: props.tool.kind === kind }"
        :title="t(`board.${kind}`)"
        :aria-label="t(`board.${kind}`)"
        :aria-pressed="props.tool.kind === kind"
        @click="props.tool.kind = kind"
      >
        <span aria-hidden="true">{{ GLYPHS[kind] }}</span>
      </button>
    </div>

    <div class="group" :aria-label="t('board.widths')" role="group">
      <button
        v-for="w in widths"
        :key="w"
        type="button"
        class="tool"
        :class="{ picked: props.tool.width === w }"
        :title="t('board.width', { n: w })"
        :aria-label="t('board.width', { n: w })"
        :aria-pressed="props.tool.width === w"
        @click="props.tool.width = w"
      >
        <span class="dot" :style="{ width: `${w / 2 + 2}px`, height: `${w / 2 + 2}px` }" aria-hidden="true" />
      </button>
    </div>

    <div class="group" :aria-label="t('board.wholeBoard')" role="group">
      <button type="button" class="tool" :title="t('board.undo')" :aria-label="t('board.undo')" @click="$emit('undo')"><span aria-hidden="true">↶</span></button>
      <button type="button" class="tool" :title="t('board.clear')" :aria-label="t('board.clear')" @click="$emit('clear')"><span aria-hidden="true">🗑️</span></button>
    </div>
  </div>
</template>

<style scoped>
.toolbox {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
}
.colour-row {
  display: flex;
}
.swatch {
  width: 1.3rem;
  height: 1.3rem;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 0;
}
.swatch.picked {
  outline: 2px solid var(--amber);
  outline-offset: -2px;
  z-index: 1;
}
.group {
  display: flex;
  gap: 0.25rem;
}
.tool {
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  padding: 0;
  font-size: 1rem;
}
.tool.picked {
  outline: 2px solid var(--amber);
  outline-offset: -2px;
}
.dot {
  display: block;
  background: var(--parchment);
  border-radius: 50%;
}
</style>
