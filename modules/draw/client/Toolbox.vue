<script setup>
// The drawer's tools, under their own board: the palette, three brush sizes, the pen, the rubber, the paint bucket,
// undo and clear.  The two rows of colours are the palette the instructions name by place (shared/drawing.js), the
// bright ones above their darker twins.
// Props: tool ({ kind, colour, width }, changed in place).
// Emits: undo, clear.  Slots: none.
// Side effects: none beyond changing the tool it was given.
import { PALETTE } from '../../../src/drawBoard.js';
import { useGameText } from '../../../src/useGameText.js';
import { WIDTHS } from './useTools.js';

const props = defineProps({ tool: { type: Object, required: true } });
defineEmits(['undo', 'clear']);
const { t } = useGameText();

// The palette in two rows, as the colours were meant to be shown: the bright ones above their darker twins.
const rows = [PALETTE.slice(0, 13), PALETTE.slice(13)];
/** The three kinds of tool, with the word each one is called by. */
const kinds = [
  { kind: 'pen', label: 'table.pen', glyph: '✏️' },
  { kind: 'rubber', label: 'table.rubber', glyph: '🧽' },
  { kind: 'fill', label: 'table.fill', glyph: '🪣' },
];
</script>

<template>
  <div class="toolbox">
    <div class="colours" role="group" :aria-label="t('table.colours')">
      <div v-for="(row, r) in rows" :key="r" class="colour-row">
        <button
          v-for="(hex, n) in row"
          :key="hex"
          type="button"
          class="swatch"
          :class="{ picked: props.tool.colour === r * 13 + n && props.tool.kind !== 'rubber' }"
          :style="{ background: hex }"
          :title="t('table.colour', { n: r * 13 + n + 1 })"
          :aria-label="t('table.colour', { n: r * 13 + n + 1 })"
          @click="(props.tool.colour = r * 13 + n), (props.tool.kind = props.tool.kind === 'rubber' ? 'pen' : props.tool.kind)"
        />
      </div>
    </div>
    <div class="row">
      <button
        v-for="one in kinds"
        :key="one.kind"
        type="button"
        class="tool"
        :class="{ picked: props.tool.kind === one.kind }"
        :title="t(one.label)"
        :aria-label="t(one.label)"
        @click="props.tool.kind = one.kind"
      >
        {{ one.glyph }}
      </button>
      <button
        v-for="width in WIDTHS"
        :key="width.width"
        type="button"
        class="tool width"
        :class="{ picked: props.tool.width === width.width }"
        :title="t(width.label)"
        :aria-label="t(width.label)"
        @click="props.tool.width = width.width"
      >
        <span class="dot" :style="{ width: `${width.dot}px`, height: `${width.dot}px` }" />
      </button>
      <span class="spacer" />
      <button type="button" class="quiet" @click="$emit('undo')">{{ t('table.undo') }}</button>
      <button type="button" class="quiet" @click="$emit('clear')">{{ t('table.clear') }}</button>
    </div>
  </div>
</template>

<style scoped>
.toolbox {
  display: grid;
  gap: 0.35rem;
}
.colours {
  display: grid;
  gap: 2px;
}
.colour-row {
  display: flex;
  gap: 2px;
}
.swatch {
  width: 20px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 3px;
  cursor: pointer;
}
.swatch.picked {
  outline: 2px solid var(--amber);
  outline-offset: 1px;
}
.tool {
  min-width: 2.2rem;
  padding: 0.2rem 0.4rem;
}
.tool.picked {
  border-color: var(--amber);
  color: var(--amber);
}
.width {
  display: grid;
  place-items: center;
}
.dot {
  display: block;
  border-radius: 50%;
  background: currentColor;
}
.spacer {
  flex: 1;
}
</style>
