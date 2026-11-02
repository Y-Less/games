<script setup>
// The card viewer: a large look at one card, opened by setting store.zoom ({ cardId, cards?, actions? | actionsFor? }).
// If the zoom carries the row of cards it came from, you can step through them (buttons or arrow keys); Escape or a
// click outside closes it. Each action (for example "Play this card") closes the viewer, then runs.
//
// Props: none. Emits: none. Slots: none.
// Side effects: sets store.zoom (to step or close); listens to window keydown while mounted (removed on unmount);
// runs the chosen action's `run` callback.
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';
import CardImg from './CardImg.vue';

const { t, text } = useGameText();
const { store } = useDixnt();

// Closes the viewer.
const close = () => (store.zoom = null);

// A zoom may carry the whole row of cards it came from (cards) so the viewer can step through them, and
// actionsFor(cardId) when the buttons depend on which card is showing.
// The cards that can be stepped through (empty when the zoom is a single card).
const cards = computed(() => store.zoom?.cards ?? []);
// Where the showing card is in `cards` (-1 if it is not there).
const position = computed(() => cards.value.indexOf(store.zoom?.cardId));
// True when there is more than one card to step through.
const canStep = computed(() => cards.value.length > 1 && position.value >= 0);
// The buttons for the card showing: computed per card when the zoom has `actionsFor`, otherwise its fixed `actions`.
const actions = computed(() => (store.zoom?.actionsFor ? store.zoom.actionsFor(store.zoom.cardId) : (store.zoom?.actions ?? [])));

/**
 * Moves to a neighbouring card, wrapping round at either end.
 * @param {number} by  -1 for the previous card, 1 for the next.
 * @returns {void}
 * Side effects: replaces store.zoom with the new card id (does nothing if stepping is not possible).
 */
function step(by) {
  if (!canStep.value) return;
  const n = cards.value.length;
  store.zoom = { ...store.zoom, cardId: cards.value[(position.value + by + n) % n] };
}

/**
 * Runs one of the viewer's buttons: closes the viewer first so the table is visible while the action happens.
 * @param {{run: () => any}} action  The chosen action.
 * @returns {Promise<void>}
 * Side effects: closes the viewer; whatever `action.run` does.
 */
async function run(action) {
  close();
  await action.run();
}

/**
 * Keyboard shortcuts while the viewer is open: Escape closes, the arrow keys step.
 * @param {KeyboardEvent} event  The key event.
 * @returns {void}
 * Side effects: may close or step (see those).
 */
function onKey(event) {
  if (!store.zoom) return;
  if (event.key === 'Escape') close();
  else if (event.key === 'ArrowLeft') step(-1);
  else if (event.key === 'ArrowRight') step(1);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="store.zoom" class="backdrop" @click.self="close">
      <div class="viewer" role="dialog" aria-modal="true" :aria-label="t('table.cardPreview')">
        <div class="stage">
          <button v-if="canStep" class="nav" :aria-label="t('table.previousCard')" @click="step(-1)">‹</button>
          <CardImg :card-id="store.zoom.cardId" size="medium" class="big" />
          <button v-if="canStep" class="nav" :aria-label="t('table.nextCard')" @click="step(1)">›</button>
        </div>
        <p v-if="canStep" class="muted count">{{ t('table.position', { n: position + 1, total: cards.length }) }}</p>
        <div class="actions">
          <button
            v-for="action in actions"
            :key="action.label"
            :class="{ primary: action.primary }"
            @click="run(action)"
          >
            {{ text(action.label) }}
          </button>
          <button class="quiet" @click="close">{{ $t('common.close') }}</button>
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
.big {
  height: min(78vh, 760px);
  width: auto;
  max-width: 92vw;
}
.actions {
  display: flex;
  gap: 0.6rem;
}
</style>
