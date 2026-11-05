<script setup>
// The content of the Status box: the round and question the game is on, which category the wheel picked, how long is
// left, and the one line that says what is happening and what to do about it.
// Props: state (the server view), view (the reactive game view), lit (whether the right answer is up yet).
// Emits: none.  Slots: none.
// Side effects: none itself; useTurnClock runs a countdown while a question is up.
import { computed } from 'vue';
import { animationsPlaying } from '../../../src/appearance.js';
import GameStatus from '../../../src/components/GameStatus.vue';
import { useGameText } from '../../../src/useGameText.js';
import { useTurnClock } from '../../../src/useTurnClock.js';

const props = defineProps({
  state: { type: Object, required: true },
  view: { type: Object, required: true },
  lit: { type: Boolean, default: false },
});
const { t } = useGameText();
const { secondsLeft } = useTurnClock(() => props.state);

// Whether this player has motion: a wheel that is not going to turn has nothing to watch, so there is nothing to
// give away either, and the words should not claim it is spinning.
const turning = computed(() => props.view.spinning && animationsPlaying());
// The name of the category the wheel picked.  It is kept back while the wheel is actually turning: watching it land
// is the point, and a line of words above the board would give the ending away.
const category = computed(() => (props.view.category && !turning.value ? t(`category.${props.view.category}`) : ''));
// The right answer in words, once it is up.
const answer = computed(() => (props.lit && props.state.correct !== null ? (props.state.question?.answers[props.state.correct] ?? '') : ''));
// Your own answer to the question just closed, if you gave one.
const mine = computed(() => props.state.result?.entries.find((entry) => entry.id === props.state.you) ?? null);

// The one line that matters now.
const headline = computed(() => {
  if (props.view.abandoned) return t('status.ranOut');
  if (props.view.ended) return t('status.finished');
  if (turning.value) return t('status.spinning');
  if (props.view.spinning) return t('status.landed', { name: category.value });
  if (props.view.asking) return props.view.canAnswer ? t('status.yourAnswer') : t('status.locked');
  if (answer.value) return t('status.theAnswer', { answer: answer.value });
  return t('status.revealing');
});
// True when the headline is about something you have to do.
const mineNow = computed(() => props.view.canAnswer);

// Everything else worth saying.
const lines = computed(() => {
  const out = [];
  if (turning.value) out.push({ text: t('status.spinHint'), tone: 'muted' });
  if (props.view.asking) {
    out.push({ text: t('status.quickest', { points: props.state.limits.points }), tone: 'muted' });
    out.push({ text: t('status.answered', { n: props.view.answeredCount, total: props.state.players.length }), tone: 'muted' });
  }
  if (props.view.revealing && mine.value) out.push({ text: mine.value.right ? t('status.youGot', { points: mine.value.points }) : t('status.youMissedIt'), tone: mine.value.right ? 'mine' : 'warn' });
  if (props.view.revealing && !mine.value && props.view.mine) out.push({ text: t('status.youSaidNothing'), tone: 'warn' });
  if (props.view.ended) out.push({ text: t('status.finishedHint'), tone: 'muted' });
  return out;
});
</script>

<template>
  <!-- No "it's your turn" pop-up: everybody answers every question at once, so it would fire on all of them and say nothing. -->
  <GameStatus :headline="headline" :mine="mineNow" :turn="false" :lines="lines">
    <template #facts>
      <span>{{ t('facts.round', { n: state.round, total: state.rounds }) }}</span>
      <span>{{ t('facts.question', { n: state.ask, total: state.perRound }) }}</span>
      <span v-if="category">{{ t('facts.category', { name: category }) }}</span>
      <span v-if="secondsLeft !== null">{{ t('facts.seconds', { count: secondsLeft }, secondsLeft) }}</span>
    </template>
  </GameStatus>
</template>
