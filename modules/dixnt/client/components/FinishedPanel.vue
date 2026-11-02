<script setup>
// The end of the game, in the place of the table: who won and the final standings. (The way back to the lobby is in
// the controls zone under it.)
//
// Props: none. Emits: none. Slots: none.
// Side effects: none (pure rendering from the store).
import { computed } from 'vue';
import { placements } from '../../../../shared/scores.js';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';

const { t, list } = useGameText();
const { players, store } = useDixnt();

// The current state (the game is finished, so it is never null here).
const state = computed(() => store.state);
// The same players and totals as the scores pop-up (state.scoreboard), best first; tied players share a place.
const standings = computed(() => {
  const rows = state.value.scoreboard.players;
  const places = placements(Object.fromEntries(rows.map((p) => [p.id, p.score])));
  return [...rows].sort((a, b) => b.score - a.score).map((p) => ({ ...p, place: places[p.id] }));
});
// The winning players (several if tied).
const winners = computed(() => players.value.filter((p) => state.value.winners.includes(p.id)));
// The winners' names as prose, joined the way the language joins a list: 'A', or 'A, B and C'.
const winnerNames = computed(() => list(winners.value.map((p) => p.name)));
// The heading: a tie names them all, one winner is named on their own.
const headline = computed(() => (winners.value.length > 1 ? t('finished.tie', { names: winnerNames.value }) : t('scoreboard.wins', { name: winnerNames.value })));
</script>

<template>
  <section class="finished" :aria-label="t('facts.gameOver')">
    <h2>{{ headline }}</h2>
    <p v-if="winners.length" class="muted">{{ t('finished.withPoints', { count: winners[0].score }, winners[0].score) }}</p>
    <h3>{{ $t('scoreboard.final') }}</h3>
    <ol class="standings">
      <li v-for="p in standings" :key="p.id" :class="{ top: state.winners.includes(p.id) }">
        <span class="place">{{ p.place }}</span>
        <span class="name">{{ p.name }}</span>
        <span class="score">{{ p.score }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.finished {
  width: min(32rem, 100%);
  max-height: 100%;
  margin: 0 auto;
  overflow-y: auto;
  padding: 0.8rem 1.2rem;
  text-align: center;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--amber);
  border-radius: var(--radius);
}
.finished h2 {
  font-size: 1.8rem;
  color: var(--amber);
}
.finished p {
  margin: 0 0 0.4rem;
}
.finished h3 {
  margin-top: 0.4rem;
}
.standings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
  text-align: left;
}
.standings li {
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.25rem;
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
