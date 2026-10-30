<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { session } from '../session.js';

const CATEGORY_LABELS = { party: 'Party games', cards: 'Card games', strategy: 'Strategy games', word: 'Word games', other: 'More games' };

const groups = computed(() => {
  const byCategory = new Map();
  for (const game of session.games) {
    if (!byCategory.has(game.category)) byCategory.set(game.category, []);
    byCategory.get(game.category).push(game);
  }
  return [...byCategory].map(([key, games]) => ({ key, label: CATEGORY_LABELS[key] ?? key, games }));
});

const players = (g) => (g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`);
</script>

<template>
  <section class="stack">
    <h1>Welcome, {{ session.user.displayName }}</h1>
    <p class="muted">Choose a game.</p>

    <p v-if="!session.games.length" class="panel">No games are installed yet. Add one to the <code>modules</code> folder.</p>

    <div v-for="group in groups" :key="group.key" class="stack">
      <h2>{{ group.label }}</h2>
      <div class="grid">
        <RouterLink v-for="game in group.games" :key="game.id" :to="`/play/${game.id}`" class="game panel">
          <h3>{{ game.name }}</h3>
          <p class="muted">{{ game.description }}</p>
          <span class="meta muted">{{ players(game) }}</span>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
h1 {
  color: var(--amber);
}
.stack > h1,
.stack > p {
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.9rem;
}
.game {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  text-decoration: none;
  color: var(--parchment);
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
  transition: transform 0.12s, border-color 0.12s;
}
.game:hover {
  transform: translateY(-2px);
  border-color: var(--amber);
}
.game p {
  margin: 0;
  flex: 1;
}
.meta {
  font-size: 0.85rem;
}
</style>
