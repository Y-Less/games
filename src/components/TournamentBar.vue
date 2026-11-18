<script setup>
// File: the line above a game that is part of a tournament.  Depends on: Vue only.
//
// While you are playing a game a tournament drew you for, the tournament is another room: you are not looking at it,
// and it moves on without you while you play.  This says where it has got to and offers the way on — the next game
// when yours is over and the next round has opened, and the tournament itself otherwise.
//
// It never moves anybody by itself, for the reason TourBand.vue gives: being pulled off a final score sheet you were
// still reading would be worse than having to click.
//
// Props: tournament (the `tournament` block of the state), busy (Boolean).
// Emits: go(code); ready(on) — said from here as readily as from the tournament, since somebody reading the last of
// the scores is exactly who the next round is waiting for.  The parent sends them.
// Side effects: none itself; only emits.
import { computed } from 'vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  tournament: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});
const { t } = useGameText();
const emit = defineEmits(['go', 'ready']);

/** The game this person is meant to be at now, when it is not the one they are looking at. */
const next = computed(() => (props.tournament.yourTable && props.tournament.yourTable !== props.tournament.here ? props.tournament.yourTable : null));
/** The tournament has been forgotten (it was swept, or the server lost it): there is nowhere to go back to. */
const lost = computed(() => Boolean(props.tournament.lost));
/** The next round is waiting on people, and this person has not said they are ready yet. */
const askReady = computed(() => !lost.value && Boolean(props.tournament.waiting) && !props.tournament.youReady);
</script>

<template>
  <section class="panel row bar">
    <span class="muted">{{ lost ? t('tournament.title') : t('tournament.round', { round: props.tournament.round, rounds: props.tournament.rounds }) }}</span>
    <button v-if="next" class="primary" :disabled="props.busy" @click="emit('go', next)">{{ t('tournament.nextTable') }}</button>
    <button v-else-if="askReady" class="primary" :disabled="props.busy" @click="emit('ready', true)">{{ t('tournament.readyUp') }}</button>
    <button v-if="!lost && !next" class="quiet" :disabled="props.busy" @click="emit('go', props.tournament.parent)">{{ t('tournament.back') }}</button>
  </section>
</template>

<style scoped>
.bar {
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.4rem 0.8rem;
}
</style>
