<script setup>
import { computed } from 'vue';
import { useDixnt } from '../useDixnt.js';
import Table from './Table.vue';
import WordBanner from './WordBanner.vue';

const { nameOf, players, send, store } = useDixnt();

const state = computed(() => store.state);
const results = computed(() => state.value.results);
const gained = (id) => results.value.deltas[id] ?? 0;
const chooserId = computed(() => state.value.chooserId);
const isLastRound = computed(() => state.value.completedRounds >= state.value.totalRounds);
const nextChooser = computed(() => {
  const list = players.value;
  const current = list.findIndex((p) => p.isChooser);
  return list[(current + 1) % list.length]?.name;
});
</script>

<template>
  <WordBanner />

  <section class="panel stack verdict" :class="results.groupCorrect !== false ? 'caught' : 'escaped'">
    <!-- Favourite style: nobody was bluffing, the chooser just picked a card -->
    <template v-if="results.judging === 'favourite'">
      <h2>{{ nameOf(chooserId) }} picked {{ nameOf(results.winnerId) }}’s card!</h2>
      <p>{{ nameOf(results.winnerId) }} scores {{ state.pointsFavourite }}.</p>
    </template>

    <!-- Imposter styles -->
    <template v-else>
      <h2>{{ nameOf(results.imposterId) }} was the imposter!</h2>
      <template v-if="results.judging === 'chooser'">
        <p v-if="results.groupCorrect">
          {{ nameOf(chooserId) }} guessed right and scores {{ state.pointsChooserCorrect }}.
        </p>
        <p v-else>
          {{ nameOf(chooserId) }} was fooled! {{ nameOf(results.imposterId) }} scores {{ state.pointsFooledChooser }}.
        </p>
      </template>
      <template v-else>
        <p v-if="results.groupCorrect">The group found them. Everyone who voted for them scores {{ state.pointsPerVote }}.</p>
        <p v-else>
          The group was fooled! {{ nameOf(results.imposterId) }} scores {{ gained(results.imposterId) }}
          ({{ state.pointsPerVote }} for each player who missed them).
        </p>
      </template>
    </template>
  </section>

  <Table />

  <section class="panel stack">
    <p class="muted small">Every round so far is in the scores table above (use “All rounds”).</p>
    <button v-if="isLastRound" class="primary" @click="send('nextRound')">That was the last round: see the final scores</button>
    <template v-else>
      <button class="primary" @click="send('nextRound')">Next round: {{ nextChooser }} chooses the word</button>
      <p class="muted small">Played cards are discarded and everyone draws back up to {{ state.handSize }} cards.</p>
    </template>
  </section>
</template>

<style scoped>
.verdict {
  text-align: center;
}
.verdict p {
  margin: 0;
}
.caught {
  border-color: var(--moss);
}
.escaped {
  border-color: var(--rust);
}
.small {
  margin: 0;
  font-size: 0.85rem;
}
</style>
