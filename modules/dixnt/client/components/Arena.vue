<script setup>
// The main area of a Dixnt game, in three fixed zones that never move between phases: the table of played cards on
// top, a one-line zone of controls (the chooser's word, the next-round button, the host's buttons), and your hand along
// the bottom. Every size comes from the room the frame gives (`width` x `height`), never from the game.
import { computed, nextTick, ref, watch } from 'vue';
import { useDixnt } from '../useDixnt.js';
import { CONTROLS, GAP, fitCards, handCard } from '../layout.js';
import FinishedPanel from './FinishedPanel.vue';
import Hand from './Hand.vue';
import Table from './Table.vue';

const props = defineProps({
  width: { type: Number, required: true },
  height: { type: Number, required: true },
});

const { isHost, players, send, store } = useDixnt();
const state = computed(() => store.state);
const phase = computed(() => state.value.phase);
const finished = computed(() => phase.value === 'finished');

// ---- the sizes ----
const hand = computed(() => handCard(props.width, props.height, Math.max(state.value.handSize, state.value.me.hand.length, 1)));
const inRound = computed(() => players.value.filter((p) => !p.waiting).length);
const cards = computed(() => fitCards(inRound.value, props.width, props.height - CONTROLS - hand.value.height - GAP * 2));
const rows = computed(() => `minmax(0, 1fr) ${CONTROLS}px ${hand.value.height}px`);

// ---- the chooser's word ----
const word = ref('');
const hints = ref([]);
const busy = ref(false);
const input = ref(null);
const choosing = computed(() => phase.value === 'word' && state.value.me.isChooser);

async function getHints() {
  const reply = await send('hints');
  if (reply.ok) hints.value = reply.hints;
}
async function submit() {
  if (busy.value || !word.value.trim()) return;
  busy.value = true;
  await send('submitWord', { word: word.value });
  busy.value = false;
}
watch(choosing, async (now) => {
  if (!now) {
    word.value = '';
    hints.value = [];
    return;
  }
  await nextTick();
  input.value?.focus();
}, { immediate: true, flush: 'post' });

// ---- the end of a round, and the host's buttons ----
const isLastRound = computed(() => state.value.completedRounds >= state.value.totalRounds);
const nextChooser = computed(() => {
  const list = players.value;
  const current = list.findIndex((p) => p.isChooser);
  return list[(current + 1) % list.length]?.name;
});
async function endGame() {
  if (window.confirm('End the game and return everyone to the lobby? Scores are reset.')) await send('endGame');
}
async function skipRound() {
  if (window.confirm('Abandon this round (no points) and move on to the next word-chooser?')) await send('abortRound');
}
</script>

<template>
  <div class="arena" :style="{ gridTemplateRows: rows }">
    <div class="table-zone">
      <FinishedPanel v-if="finished" />
      <div v-else-if="choosing && hints.length" class="ideas" aria-label="Ideas for a word">
        <button v-for="hint in hints" :key="hint" type="button" class="chip" :class="{ picked: word === hint }" @click="word = hint">{{ hint }}</button>
      </div>
      <Table v-else :card-width="cards.width" :card-height="cards.height" :count="inRound" :columns="cards.columns" />
    </div>

    <div class="controls">
      <form v-if="choosing" class="word" @submit.prevent="submit">
        <input ref="input" v-model="word" maxlength="60" placeholder="Your word or phrase" aria-label="Your word or phrase" />
        <button type="button" @click="getHints">{{ hints.length ? 'More ideas' : 'Give me ideas' }}</button>
        <button class="primary" :disabled="!word.trim() || busy">Lock it in</button>
      </form>
      <template v-else-if="phase === 'results'">
        <button v-if="isLastRound" class="primary" @click="send('nextRound')">That was the last round: see the final scores</button>
        <button v-else class="primary" @click="send('nextRound')">Next round: {{ nextChooser }} chooses the word</button>
      </template>
      <button v-else-if="finished && isHost" class="primary" @click="send('endGame')">Back to the lobby</button>
      <span class="spacer" />
      <div v-if="isHost && !finished" class="host">
        <button v-if="['word', 'picking', 'voting'].includes(phase)" class="quiet" @click="skipRound">Skip round</button>
        <button class="quiet" @click="endGame">End game</button>
      </div>
    </div>

    <div class="hand-zone"><Hand :card-width="hand.width" :card-height="hand.height" /></div>
  </div>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  row-gap: 8px;
  min-height: 0;
}
.table-zone {
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.ideas {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
  max-width: 60rem;
}
.chip {
  font-size: 1.05rem;
  border-style: dashed;
  background: transparent;
}
.chip.picked {
  border-style: solid;
  border-color: var(--amber);
  color: var(--amber);
}
.controls {
  display: flex;
  align-items: stretch;
  gap: 0.6rem;
  min-width: 0;
}
.controls > * {
  min-height: 0;
}
.word {
  flex: 1;
  display: flex;
  gap: 0.5rem;
  min-width: 0;
}
.word input {
  flex: 1;
  min-width: 0;
}
.spacer {
  flex: 1;
}
.host {
  display: flex;
  gap: 0.3rem;
  align-items: stretch;
}
.hand-zone {
  min-height: 0;
  overflow: visible;
}
</style>
