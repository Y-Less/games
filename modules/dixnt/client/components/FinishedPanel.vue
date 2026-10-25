<script setup>
import { computed } from 'vue';
import { placements } from '../../../../shared/scores.js';
import { useDixnt } from '../useDixnt.js';

const { isHost, players, send, store } = useDixnt();

const state = computed(() => store.state);
// The same players and totals as the scores pop-up (state.scoreboard), best first; tied players share a place.
const standings = computed(() => {
  const rows = state.value.scoreboard.players;
  const places = placements(Object.fromEntries(rows.map((p) => [p.id, p.score])));
  return [...rows].sort((a, b) => b.score - a.score).map((p) => ({ ...p, place: places[p.id] }));
});
const winners = computed(() => players.value.filter((p) => state.value.winners.includes(p.id)));
const winnerNames = computed(() => {
  const names = winners.value.map((p) => p.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
});
</script>

<template>
  <section class="panel stack finished">
    <p class="muted label">Game over after {{ state.completedRounds }} round{{ state.completedRounds === 1 ? '' : 's' }}</p>
    <h2>{{ winners.length > 1 ? `It's a tie! ${winnerNames} win` : `${winnerNames} wins!` }}</h2>
    <p v-if="winners.length" class="muted">with {{ winners[0].score }} points</p>
  </section>

  <section class="panel stack">
    <h3>Final scores</h3>
    <ol class="standings">
      <li v-for="p in standings" :key="p.id" :class="{ top: state.winners.includes(p.id) }">
        <span class="place">{{ p.place }}</span>
        <span class="name">{{ p.name }}</span>
        <span class="score">{{ p.score }}</span>
      </li>
    </ol>
    <button v-if="isHost" class="primary" @click="send('endGame')">Back to the lobby</button>
    <p v-else class="muted">Waiting for the host to take everyone back to the lobby.</p>
  </section>
</template>

<style scoped>
.finished {
  text-align: center;
  border-color: var(--amber);
}
.finished h2 {
  font-size: 2rem;
  color: var(--amber);
}
.finished p {
  margin: 0;
}
.label {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.8rem;
}
.standings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.standings li {
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.35rem;
}
.standings li.top .name {
  color: var(--amber);
}
.place {
  width: 1.5rem;
  color: var(--muted);
}
.name {
  flex: 1;
  font-weight: 600;
}
.score {
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
}
</style>
