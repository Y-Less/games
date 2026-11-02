<script setup>
// The main area of a Dixnt game, in three fixed zones that never move between phases: the table of played cards on
// top, a one-line zone of controls (the chooser's word, the next-round button, the host's buttons), and your hand along
// the bottom.  Every size comes from the room the frame gives (`width` x `height`), never from the game.
//
// Props:
//   width   {number}  required.  Width of the main area in pixels.
//   height  {number}  required.  Height of the main area in pixels.
// Emits: none.  Slots: none.
// Side effects: sends submitWord, hints, nextRound, endGame and abortRound requests (the last two after a confirm
// dialog); keeps local word/hints/busy state, cleared when you stop being the chooser; focuses the word box when you
// become the chooser.
import { computed, nextTick, ref, watch } from 'vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';
import { CONTROLS, GAP, fitCards, handCard } from '../layout.js';
import FinishedPanel from './FinishedPanel.vue';
import Hand from './Hand.vue';
import Table from './Table.vue';

const props = defineProps({
  width: { type: Number, required: true },
  height: { type: Number, required: true },
});

const { t } = useGameText();
const { isHost, players, send, store } = useDixnt();
// The current state.
const state = computed(() => store.state);
// The current phase: lobby, word, picking, voting, results, or finished.
const phase = computed(() => state.value.phase);
// True once the game is over.
const finished = computed(() => phase.value === 'finished');

// ---- the sizes ----
// Size of a card in your hand: sized for a full hand so the zone never changes.
const hand = computed(() => handCard(props.width, props.height, Math.max(state.value.handSize, state.value.me.hand.length, 1)));
// How many players are in this round (those who joined mid-round are waiting).
const inRound = computed(() => players.value.filter((p) => !p.waiting).length);
// Size and grid of the cards on the table, from what is left after the controls and the hand.
const cards = computed(() => fitCards(inRound.value, props.width, props.height - CONTROLS - hand.value.height - GAP * 2));
// The CSS grid rows of the three fixed zones: table (flexible), controls, hand.
const rows = computed(() => `minmax(0, 1fr) ${CONTROLS}px ${hand.value.height}px`);

// ---- the chooser's word ----
// The word being typed by the chooser.
const word = ref('');
// Suggested words from the server, shown as chips in place of the table.
const hints = ref([]);
// True while the word is being sent, so it cannot be sent twice.
const busy = ref(false);
// Template ref to the word box, so it can be focused.
const input = ref(null);
// True when it is the viewer's turn to choose the word.
const choosing = computed(() => phase.value === 'word' && state.value.me.isChooser);

/**
 * Asks the server for word ideas and shows them.
 * @returns {Promise<void>}
 * Side effects: sends a `hints` request; sets `hints` if it succeeded.
 */
async function getHints() {
  const reply = await send('hints');
  if (reply.ok) hints.value = reply.hints;
}
/**
 * Sends the typed word to start the round (ignored if empty or already sending).
 * @returns {Promise<void>}
 * Side effects: sends `submitWord`; toggles `busy`.
 */
async function submit() {
  if (busy.value || !word.value.trim()) return;
  busy.value = true;
  await send('submitWord', { word: word.value });
  busy.value = false;
}
// When you become the chooser, focus the word box; when you stop, forget the word and the ideas.
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
// True when the round just finished was the last one.
const isLastRound = computed(() => state.value.completedRounds >= state.value.totalRounds);
// Name of the player who chooses the next word (the next in seat order after the current chooser).
const nextChooser = computed(() => {
  const list = players.value;
  const current = list.findIndex((p) => p.isChooser);
  return list[(current + 1) % list.length]?.name;
});
/**
 * Host only: ends the game and returns everyone to the lobby, after asking.
 * @returns {Promise<void>}
 * Side effects: shows a confirm dialog; sends `endGame` if confirmed (scores are reset).
 */
async function endGame() {
  if (window.confirm(t('table.confirmEnd'))) await send('endGame');
}
/**
 * Host only: abandons the current round (no points) and moves to the next chooser, after asking.
 * @returns {Promise<void>}
 * Side effects: shows a confirm dialog; sends `abortRound` if confirmed.
 */
async function skipRound() {
  if (window.confirm(t('table.confirmSkip'))) await send('abortRound');
}
</script>

<template>
  <div class="arena" :style="{ gridTemplateRows: rows }">
    <div class="table-zone">
      <FinishedPanel v-if="finished" />
      <div v-else-if="choosing && hints.length" class="ideas" :aria-label="t('table.ideas')">
        <button v-for="hint in hints" :key="hint" type="button" class="chip" :class="{ picked: word === hint }" @click="word = hint">{{ hint }}</button>
      </div>
      <Table v-else :card-width="cards.width" :card-height="cards.height" :count="inRound" :columns="cards.columns" />
    </div>

    <div class="controls">
      <form v-if="choosing" class="word" @submit.prevent="submit">
        <input ref="input" v-model="word" maxlength="60" :placeholder="t('table.wordPlaceholder')" :aria-label="t('table.wordPlaceholder')" />
        <button type="button" @click="getHints">{{ t(hints.length ? 'table.moreIdeas' : 'table.giveIdeas') }}</button>
        <button class="primary" :disabled="!word.trim() || busy">{{ t('table.lockIn') }}</button>
      </form>
      <template v-else-if="phase === 'results'">
        <button v-if="isLastRound" class="primary" @click="send('nextRound')">{{ t('table.lastRound') }}</button>
        <button v-else class="primary" @click="send('nextRound')">{{ t('table.nextRound', { name: nextChooser }) }}</button>
      </template>
      <button v-else-if="finished && isHost" class="primary" @click="send('endGame')">{{ t('table.backToLobby') }}</button>
      <span class="spacer" />
      <div v-if="isHost && !finished" class="host">
        <button v-if="['word', 'picking', 'voting'].includes(phase)" class="quiet" @click="skipRound">{{ t('table.skipRound') }}</button>
        <button class="quiet" @click="endGame">{{ t('table.endGame') }}</button>
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
