<script setup>
// The standard scoreboard for every game:
//   - a bar with everyone's current score, always visible (it sticks under the site header while the page scrolls);
//   - a large pop-up with every round so far, which opens by itself after each round and again at the end,
//     and any time from the "All rounds" button.
// Give it the standard shape from shared/scores.js. Slots: #round (extra detail about the round that has just
// finished, shown above the table in the pop-up) and #footer (replaces the default Continue button).
import { computed, ref, watch } from 'vue';
import { placements } from '../../shared/scores.js';
import GameModal from './GameModal.vue';
import ScoreTable from './ScoreTable.vue';

const props = defineProps({
  players: { type: Array, required: true }, // [{ id, name, score, isMe?, away?, note? }]
  rounds: { type: Array, default: () => [] },
  lowIsBetter: { type: Boolean, default: false },
  target: { type: Number, default: null },
  finished: { type: Boolean, default: false },
  autoOpen: { type: Boolean, default: true }, // open the pop-up when a round finishes
  running: { type: Boolean, default: false },
  sticky: { type: Boolean, default: true },
});
const emit = defineEmits(['closed', 'continue']);

const open = ref(false);
const justFinished = ref(false); // the pop-up was opened by a round ending (rather than by the button)

const places = computed(() => placements(Object.fromEntries(props.players.map((p) => [p.id, p.score])), { lowIsBetter: props.lowIsBetter }));
const winners = computed(() => props.players.filter((p) => places.value[p.id] === 1));
const lastRound = computed(() => props.rounds.at(-1) ?? null);
const title = computed(() => {
  if (props.finished) return 'Final scores';
  if (justFinished.value && lastRound.value) return `Scores after ${lastRound.value.label}`;
  return 'Scores so far';
});

// A new round arriving while the page is open (not the history that arrives when you reconnect) opens the pop-up.
let seen = props.rounds.length;
watch(
  () => props.rounds.length,
  (count) => {
    if (count > seen && props.autoOpen) {
      justFinished.value = true;
      open.value = true;
    }
    seen = count;
  },
);
watch(
  () => props.finished,
  (done, was) => {
    if (done && !was && props.autoOpen) {
      justFinished.value = true;
      open.value = true;
    }
  },
);

function show() {
  justFinished.value = false;
  open.value = true;
}
function close() {
  open.value = false;
  closed();
}
function proceed() {
  emit('continue'); // lets a game treat Continue as "ready for the next round"
  close();
}
function closed() {
  justFinished.value = false;
  emit('closed');
}
defineExpose({ show, close });
</script>

<template>
  <section class="score-bar" :class="{ sticky }" aria-label="Scores">
    <ul class="chips">
      <li v-for="p in players" :key="p.id" class="chip" :class="{ me: p.isMe, lead: places[p.id] === 1 && players.some((q) => q.score !== p.score), away: p.away }">
        <span class="name">{{ p.name }}<span v-if="p.isMe" class="you"> (you)</span></span>
        <strong class="points">{{ p.score }}</strong>
        <small v-if="p.note" class="muted">{{ p.note }}</small>
      </li>
    </ul>
    <button class="quiet all" @click="show">All rounds</button>
  </section>

  <GameModal v-model:open="open" :title="title" size="lg" @close="closed">
    <p v-if="finished && winners.length" class="winner" role="status">
      <template v-if="winners.length === 1">{{ winners[0].name }}{{ winners[0].isMe ? ' (you)' : '' }} wins!</template>
      <template v-else>A tie: {{ winners.map((w) => w.name).join(' and ') }} win.</template>
    </p>
    <slot name="round" />
    <ScoreTable :players="players" :rounds="rounds" :low-is-better="lowIsBetter" :target="target" :running="running" />
    <template #footer>
      <slot name="footer"><button class="primary" data-autofocus @click="proceed">{{ finished ? 'Close' : 'Continue' }}</button></slot>
    </template>
  </GameModal>
</template>

<style scoped>
.score-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.6rem;
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.score-bar.sticky {
  position: sticky;
  top: var(--hub-bar-height, 3.4rem);
  z-index: 10;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
}
.chip {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
.chip.me {
  border-color: var(--amber);
}
.chip.lead .points {
  color: var(--amber);
}
.chip.lead .name::before {
  content: '★ ';
  color: var(--amber);
}
.chip.away {
  opacity: 0.6;
}
.name {
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.you {
  color: var(--amber);
}
.points {
  font-family: var(--display);
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.chip small {
  font-size: 0.72rem;
}
.winner {
  margin: 0 0 0.6rem;
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
  text-align: center;
}
@media (max-width: 480px) {
  .chip {
    padding: 0.15rem 0.5rem;
    gap: 0.3rem;
  }
  .name {
    max-width: 5.5rem;
    font-size: 0.85rem;
  }
  .points {
    font-size: 1rem;
  }
}
</style>
