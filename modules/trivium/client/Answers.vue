<script setup>
// The question and its buttons, each put exactly where the board says it goes (see layout.js) so that the markers
// have somewhere to land.  A press records which button, and whereabouts on it the finger came down.
// Props: question (the words and the answers), board (the rectangles from boardLayout), correct (the right answer's
//   index, or null until it is shown), lit (whether the right answer is lit up yet), mine (your own answer, or null),
//   active (whether you may press one now).
// Emits: pick ({ choice, x, y }) - the button and where on it, as fractions of it.
// Slots: none.  Side effects: none beyond the emit (it measures the button that was pressed).
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  question: { type: Object, required: true },
  board: { type: Object, required: true },
  correct: { type: Number, default: null },
  lit: { type: Boolean, default: false },
  mine: { type: Object, default: null },
  active: { type: Boolean, default: false },
});
const emit = defineEmits(['pick']);
const { t } = useGameText();

/**
 * Where the press landed on the button, as fractions of it.  A button reached by the keyboard was not pressed
 * anywhere in particular, so it counts as the middle.
 *
 * @param {PointerEvent} event  the click
 * @returns {{ x: number, y: number }} fractions of the button, 0 at the left and top
 * Side effects: none (it reads the button's size).
 */
function where(event) {
  const box = event.currentTarget?.getBoundingClientRect?.();
  if (!box || !box.width || !box.height || event.detail === 0) return { x: 0.5, y: 0.5 };
  const within = (value) => Math.max(0, Math.min(1, value));
  return { x: within((event.clientX - box.left) / box.width), y: within((event.clientY - box.top) / box.height) };
}

/**
 * Presses one answer.
 *
 * @param {number} choice  which answer
 * @param {PointerEvent} event  the click
 * @returns {void}
 * Side effects: emits `pick`.
 */
const press = (choice, event) => emit('pick', { choice, ...where(event) });

// The inline style that puts one rectangle where the board says.
const at = (box) => ({ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
</script>

<template>
  <div class="answers">
    <div class="question" :style="at(board.question)"><p>{{ question.text }}</p></div>
    <button
      v-for="(answer, index) in question.answers"
      :key="index"
      type="button"
      class="answer"
      :class="{ right: lit && correct === index, wrong: lit && correct !== null && correct !== index, chosen: mine?.choice === index, pressable: active }"
      :style="at(board.buttons[index] ?? board.question)"
      :disabled="!active"
      :aria-pressed="mine ? mine.choice === index : undefined"
      :title="active ? t('table.pickThis') : undefined"
      @click="press(index, $event)"
    >
      <span>{{ answer }}</span>
    </button>
  </div>
</template>

<style scoped>
.answers {
  position: absolute;
  inset: 0;
}
.question,
.answer {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  margin: 0;
}
.question p {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(1.1rem, 2.6vw, 2rem);
  line-height: 1.15;
  color: var(--parchment);
}
.answer {
  padding: 0.4rem 0.8rem;
  font-size: clamp(0.85rem, 1.5vw, 1.15rem);
  line-height: 1.2;
  color: var(--parchment);
  background: var(--bg-raised);
  border: 3px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  transition:
    border-color 160ms ease,
    opacity 300ms ease;
}
.answer span {
  display: block;
  pointer-events: none; /* a press is always on the button itself, so the spot is measured against the same box */
}
.answer.pressable:hover,
.answer.pressable:focus-visible {
  border-color: var(--amber);
}
.answer.chosen {
  border-color: var(--amber);
}
.answer.right {
  border-color: var(--moss, #4caf50);
  background: color-mix(in srgb, var(--moss, #4caf50) 24%, var(--bg-raised));
  box-shadow: 0 0 18px 3px color-mix(in srgb, var(--moss, #4caf50) 55%, transparent);
  font-weight: 650;
}
.answer.wrong {
  opacity: 0.45;
}
.answer:disabled {
  cursor: default;
}
</style>
