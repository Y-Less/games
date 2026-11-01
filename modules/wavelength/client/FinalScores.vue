<script setup>
// The final scores, best first, with the winners highlighted (shown beside the dial once the game is finished).
// Props: standings (the players sorted by score, each with placement, name, score and winner).
// Emits: none.
// Side effects: none.
defineProps({
  standings: { type: Array, required: true },
});
</script>

<template>
  <ol class="standings" aria-label="Final scores">
    <li v-for="p in standings" :key="p.id" :class="{ top: p.winner }">
      <span class="place">{{ p.placement }}</span>
      <span class="who">{{ p.name }}</span>
      <span class="points">{{ p.score }}</span>
    </li>
  </ol>
</template>

<style scoped>
.standings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: 0;
  overflow-y: auto;
}
.standings li {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.standings li.top .who {
  color: var(--amber);
}
.place {
  width: 1.2rem;
  color: var(--muted);
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--display);
}
.standings .who {
  flex: 1;
}
.points {
  font-family: var(--display);
  color: var(--amber);
}
</style>
