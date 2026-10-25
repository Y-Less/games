<script setup>
import { computed } from 'vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const abandoned = computed(() => props.state.phase === 'abandoned');
const standings = computed(() => [...props.state.players].sort((a, b) => b.score - a.score));
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
</script>

<template>
  <section class="panel stack">
    <template v-if="abandoned">
      <h2>The game was abandoned</h2>
      <p class="muted">Too many players left, so this game does not count towards the statistics.</p>
    </template>
    <template v-else>
      <h2>{{ winners.length > 1 ? 'It is a tie' : 'We have a winner' }}</h2>
      <p class="winner">{{ winners.join(' and ') }} {{ winners.length > 1 ? 'win' : 'wins' }} with {{ standings[0].score }} points.</p>
      <p class="muted">Use "All rounds" in the scoreboard above to see every turn again.</p>
    </template>
    <div><button class="primary" @click="send('leave')">Back to the menu</button></div>
  </section>
</template>

<style scoped>
.winner {
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
  margin: 0;
}
</style>