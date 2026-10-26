<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useDixnt } from '../useDixnt.js';
import CardImg from './CardImg.vue';

const { store } = useDixnt();

const close = () => (store.zoom = null);

// A zoom may carry the whole row of cards it came from (cards) so the viewer can step through them, and
// actionsFor(cardId) when the buttons depend on which card is showing.
const cards = computed(() => store.zoom?.cards ?? []);
const position = computed(() => cards.value.indexOf(store.zoom?.cardId));
const canStep = computed(() => cards.value.length > 1 && position.value >= 0);
const actions = computed(() => (store.zoom?.actionsFor ? store.zoom.actionsFor(store.zoom.cardId) : (store.zoom?.actions ?? [])));

function step(by) {
  if (!canStep.value) return;
  const n = cards.value.length;
  store.zoom = { ...store.zoom, cardId: cards.value[(position.value + by + n) % n] };
}

async function run(action) {
  close();
  await action.run();
}

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
      <div class="viewer" role="dialog" aria-modal="true" aria-label="Card preview">
        <div class="stage">
          <button v-if="canStep" class="nav" aria-label="Previous card" @click="step(-1)">‹</button>
          <CardImg :card-id="store.zoom.cardId" size="medium" class="big" />
          <button v-if="canStep" class="nav" aria-label="Next card" @click="step(1)">›</button>
        </div>
        <p v-if="canStep" class="muted count">{{ position + 1 }} of {{ cards.length }}</p>
        <div class="actions">
          <button
            v-for="action in actions"
            :key="action.label"
            :class="{ primary: action.primary }"
            @click="run(action)"
          >
            {{ action.label }}
          </button>
          <button class="quiet" @click="close">Close</button>
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
