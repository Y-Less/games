<script setup>
// The drawer's tools: the palette, the brush sizes, the pen, the rubber, the paint bucket, undo, and clear.  The two
// rows of colours are the palette the instructions name by place (../drawing.js), bright ones above their darker twins.
// Props: tool ({ kind, colour, width }, changed in place).
// Emits: undo, clear.  Slots: none.
// Side effects: none beyond changing the tool it was given.
import { useGameText } from '../../../src/useGameText.js';
import { PALETTE } from './draw.js';
import { TOOLS, WIDTHS } from './useTools.js';

const props = defineProps({ tool: { type: Object, required: true } });
defineEmits(['undo', 'clear']);
const { t } = useGameText();

// The palette in two rows, as the colours were meant to be shown: the bright ones above their darker twins.
const rows = [PALETTE.slice(0, 13), PALETTE.slice(13)];
</script>

<template>
  <div class="toolbox">
    <div class="colours" :aria-label="t('toolbox.colours')" role="group">
      <div v-for="(row, r) in rows" :key="r" class="colour-row">
        <button
          v-for="(hex, n) in row"
          :key="hex"
          type="button"
          class="swatch"
          :class="{ picked: props.tool.colour === r * 13 + n && props.tool.kind !== 'rubber' }"
          :style="{ background: hex }"
          :title="t('toolbox.colour', { n: r * 13 + n + 1 })"
          :aria-label="t('toolbox.colour', { n: r * 13 + n + 1 })"
          :aria-pressed="props.tool.colour === r * 13 + n && props.tool.kind !== 'rubber'"
          @click="
            props.tool.colour = r * 13 + n;
            props.tool.kind = props.tool.kind === 'rubber' ? 'pen' : props.tool.kind;
          "
        />
      </div>
    </div>

    <div class="group" :aria-label="t('toolbox.tools')" role="group">
      <button
        v-for="kind in TOOLS"
        :key="kind"
        type="button"
        class="tool"
        :class="{ picked: props.tool.kind === kind }"
        :title="t(`toolbox.${kind}`)"
        :aria-label="t(`toolbox.${kind}`)"
        :aria-pressed="props.tool.kind === kind"
        @click="props.tool.kind = kind"
      >
        <span aria-hidden="true">{{ { pen: '✏️', rubber: '🩹', fill: '🪣' }[kind] }}</span>
      </button>
    </div>

    <div class="group" :aria-label="t('toolbox.widths')" role="group">
      <button
        v-for="w in WIDTHS"
        :key="w"
        type="button"
        class="tool"
        :class="{ picked: props.tool.width === w }"
        :title="t('toolbox.width', { n: w })"
        :aria-label="t('toolbox.width', { n: w })"
        :aria-pressed="props.tool.width === w"
        @click="props.tool.width = w"
      >
        <span class="dot" :style="{ width: `${w / 2 + 2}px`, height: `${w / 2 + 2}px` }" aria-hidden="true" />
      </button>
    </div>

    <div class="group" :aria-label="t('toolbox.board')" role="group">
      <button type="button" class="tool" :title="t('toolbox.undo')" :aria-label="t('toolbox.undo')" @click="$emit('undo')"><span aria-hidden="true">↶</span></button>
      <button type="button" class="tool" :title="t('toolbox.clear')" :aria-label="t('toolbox.clear')" @click="$emit('clear')"><span aria-hidden="true">🗑️</span></button>
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
