<script setup>
// A large look at one thing over the top of the table - a card, a picture - with the buttons for what can be done
// with it.  If it is one of a row, the viewer steps through the row (buttons or arrow keys, wrapping round at either
// end); Escape or a click outside closes it.  Each action closes the viewer first, then runs, so the table is in view
// while it happens.
//
// What is shown is the game's: the default slot draws the item, and the words (which name the thing: "Next card")
// are props, because a shared component is not part of any one game's translations (see GameShell).
// Depends on: src/useGameText.js (for `text`, and the site's "Close").
// Props: open (is the viewer up), item (what is showing), items (the row it came from, when there is one), actions
//   ([{ label, run, primary? }] for the item showing; a label may be a message, see shared/messages.js), label (what
//   the viewer is, for a screen reader), previousLabel and nextLabel (the step buttons), countText (where the item is
//   in the row, e.g. "2 of 5").
// Emits: step (the item to show next), close.  Slots: default, given { item }.
// Side effects: listens to window keydown while mounted (removed on unmount); runs the chosen action's `run`.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  item: { type: [Number, String, Object], default: null },
  items: { type: Array, default: () => [] },
  actions: { type: Array, default: () => [] },
  label: { type: String, default: '' },
  previousLabel: { type: String, default: '' },
  nextLabel: { type: String, default: '' },
  countText: { type: String, default: '' },
});
const emit = defineEmits(['step', 'close']);
const { text } = useGameText();

// The item showing.  It is kept here as well as taken from the owner, so that two quick steps move two places: the
// owner's answer to the first has not come back by the time the second is asked for.
const showing = ref(props.item);
watch(
  () => props.item,
  (item) => (showing.value = item),
);
// Where the showing item is in `items` (-1 if it is not there).
const position = computed(() => props.items.indexOf(showing.value));
// True when there is more than one item to step through.
const canStep = computed(() => props.items.length > 1 && position.value >= 0);

/**
 * Moves to a neighbouring item, wrapping round at either end.
 * @param {number} by  -1 for the previous item, 1 for the next
 * @returns {void}
 * Side effects: emits `step` with the item to show (nothing if stepping is not possible).
 */
function step(by) {
  if (!canStep.value) return;
  const n = props.items.length;
  showing.value = props.items[(position.value + by + n) % n];
  emit('step', showing.value);
}

/**
 * Runs one of the viewer's buttons: closes the viewer first so the table is visible while the action happens.
 * @param {{ run: () => any }} action  the chosen action
 * @returns {Promise<void>}
 * Side effects: emits `close`; whatever `action.run` does.
 */
async function run(action) {
  emit('close');
  await action.run();
}

/**
 * Keyboard shortcuts while the viewer is open: Escape closes, the arrow keys step.
 * @param {KeyboardEvent} event  the key event
 * @returns {void}
 * Side effects: may emit `close` or `step`.
 */
function onKey(event) {
  if (!props.open) return;
  if (event.key === 'Escape') emit('close');
  else if (event.key === 'ArrowLeft') step(-1);
  else if (event.key === 'ArrowRight') step(1);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" @click.self="emit('close')">
      <div class="viewer" role="dialog" aria-modal="true" :aria-label="label">
        <div class="stage">
          <button v-if="canStep" class="nav" :aria-label="previousLabel" @click="step(-1)">‹</button>
          <slot :item="showing" />
          <button v-if="canStep" class="nav" :aria-label="nextLabel" @click="step(1)">›</button>
        </div>
        <p v-if="canStep && countText" class="muted count">{{ countText }}</p>
        <div class="actions">
          <button v-for="action in actions" :key="text(action.label)" :class="{ primary: action.primary }" @click="run(action)">
            {{ text(action.label) }}
          </button>
          <button class="quiet" @click="emit('close')">{{ $t('common.close') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgb(8 16 20 / 0.86);
  display: grid;
  place-items: center;
  padding: 1rem;
}
.viewer {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  align-items: center;
  max-height: 100%;
}
.stage {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.nav {
  font-size: 2.2rem;
  line-height: 1;
  padding: 0.6rem 1rem;
}
.count {
  margin: 0;
}
.actions {
  display: flex;
  gap: 0.6rem;
}
</style>
