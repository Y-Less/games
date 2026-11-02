<script setup>
// A window: four rows of five spaces showing each space's restriction (a tinted colour with its shape, or faint pips)
// and the dice placed on it.  It can highlight spaces (legal ones, ones to pick) and tell the parent which was clicked.
// Props: rows, grid, cell, legal, pick, chosen, titles, interactive, label (each described beside its definition below).
// Emits: cell (index of the space clicked, or chosen with Enter or Space, when interactive).  Slots: none.  Side effects: none.
import Die from './Die.vue';
import { COLOUR_HEX, PIPS, SHAPES } from './glyphs.js';
import { CELLS, COLOUR_SHAPES, COLS, restrictionOf } from '../rules.js';
import { useGameText } from '../../../src/useGameText.js';

const { t } = useGameText();
const props = defineProps({
  rows: { type: Array, required: true }, // four strings of five characters
  grid: { type: Array, default: () => Array(CELLS).fill(null) }, // CELLS dice or nulls
  cell: { type: Number, default: 64 }, // space size in px
  legal: { type: Array, default: () => [] }, // indexes to highlight as legal
  pick: { type: Array, default: () => [] }, // indexes that can be chosen (e.g. dice to move)
  chosen: { type: Array, default: () => [] }, // indexes shown as selected
  titles: { type: Object, default: () => ({}) }, // index -> explanation shown on hover
  interactive: { type: Boolean, default: false },
  label: { type: String, required: true }, // already in the player's language: every caller translates it
});
const emit = defineEmits(['cell']);

/**
 * The pattern character of a space ('.' for a blank one, a colour letter, or a shade digit).
 * @param {number} i  the space, 0 to CELLS - 1
 * @returns {string} the character
 * Side effects: none.
 */
const char = (i) => props.rows[Math.floor(i / COLS)]?.[i % COLS] ?? '.';
/**
 * The colour a space asks for (a colour name from rules.js), or null if it asks for none.
 * @param {number} i  the space
 * @returns {string | null}
 * Side effects: none.
 */
const colourOf = (i) => restrictionOf(char(i))?.colour ?? null;
/**
 * The shade (1-6) a space asks for, or null if it asks for none.
 * @param {number} i  the space
 * @returns {number | null}
 * Side effects: none.
 */
const shadeOf = (i) => restrictionOf(char(i))?.shade ?? null;
/**
 * The CSS classes of a space: whether it is highlighted as legal, pickable, or chosen, and what it holds or asks for.
 * @param {number} i  the space
 * @returns {Record<string, boolean>} class name -> whether it applies
 * Side effects: none.
 */
const classes = (i) => ({
  legal: props.legal.includes(i),
  pick: props.pick.includes(i),
  chosen: props.chosen.includes(i),
  filled: Boolean(props.grid[i]),
  coloured: Boolean(colourOf(i)),
  shaded: Boolean(shadeOf(i)),
});
/**
 * The words a screen reader reads for a space: what it asks for, where it is and what it holds.
 * @param {number} i  the space
 * @returns {string} the sentence
 * Side effects: none.
 */
const describe = (i) => {
  const wants = colourOf(i) ? t('space.colour', { colour: t(`colours.${colourOf(i)}`) }) : shadeOf(i) ? t('space.shade', { shade: shadeOf(i) }) : t('space.blank');
  const where = { wants, row: Math.floor(i / COLS) + 1, column: (i % COLS) + 1 };
  const die = props.grid[i];
  return die ? t('space.labelDie', { ...where, colour: t(`colours.${die.c}`), shade: die.v }) : t('space.label', where);
};
/**
 * Tells the parent that a space was clicked (or chosen by the keyboard).
 * @param {number} i  the space
 * @returns {void}
 * Side effects: emits 'cell'.
 */
const press = (i) => emit('cell', i);
</script>

<template>
  <div class="window" :style="{ '--cell': `${cell}px`, '--cols': COLS }" role="group" :aria-label="label">
    <div
      v-for="i in CELLS"
      :key="i - 1"
      class="space"
      :class="classes(i - 1)"
      :role="interactive ? 'button' : undefined"
      :tabindex="interactive ? 0 : undefined"
      :title="titles[i - 1] ?? undefined"
      :aria-label="describe(i - 1)"
      @click="interactive && press(i - 1)"
      @keydown.enter.prevent="interactive && press(i - 1)"
      @keydown.space.prevent="interactive && press(i - 1)"
    >
      <svg v-if="!grid[i - 1] && (colourOf(i - 1) || shadeOf(i - 1))" class="mark" viewBox="0 0 40 40" aria-hidden="true">
        <template v-if="colourOf(i - 1)">
          <rect x="0" y="0" width="40" height="40" :fill="COLOUR_HEX[colourOf(i - 1)]" fill-opacity="0.32" />
          <path :d="SHAPES[COLOUR_SHAPES[colourOf(i - 1)]]" :fill="COLOUR_HEX[colourOf(i - 1)]" fill-opacity="0.55" :stroke="COLOUR_HEX[colourOf(i - 1)]" stroke-width="1.5" stroke-linejoin="round" />
        </template>
        <template v-else>
          <circle v-for="(pip, k) in PIPS[shadeOf(i - 1)]" :key="k" :cx="pip[0]" :cy="pip[1]" r="3.6" fill="#f1e7d2" fill-opacity="0.5" />
        </template>
      </svg>
      <Die v-if="grid[i - 1]" :die="grid[i - 1]" :size="cell - 8" />
    </div>
  </div>
</template>

<style scoped>
.window {
  display: grid;
  grid-template-columns: repeat(var(--cols), var(--cell));
  grid-auto-rows: var(--cell);
  gap: 3px;
  padding: 5px;
  width: max-content;
  border-radius: 10px;
  background: linear-gradient(135deg, #3d5560, #26404b);
  border: 2px solid #5b7885;
  box-shadow: inset 0 0 0 2px rgb(0 0 0 / 0.35);
}
.space {
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: var(--bg-sunken);
  border: 1px solid #3e5a67;
  overflow: hidden;
}
.mark {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.space.legal {
  outline: 3px solid var(--moss);
  outline-offset: -3px;
  background: color-mix(in srgb, var(--moss) 22%, var(--bg-sunken));
}
.space.pick {
  outline: 2px dashed var(--amber);
  outline-offset: -3px;
}
.space.chosen {
  outline: 3px solid var(--amber);
  outline-offset: -3px;
}
.space[role='button'] {
  cursor: pointer;
}
.space[role='button']:hover {
  border-color: var(--amber);
}
.space:focus-visible {
  outline: 2px solid var(--amber);
}
</style>
