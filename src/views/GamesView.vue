<script setup>
// The home page: the available games, grouped by category, each linking to its table.
// Props: none.  Emits: none.  Slots: none.
// Depends on: session.js (session.games, from /api/config), catalogueText.js (the names a language may translate) and
// vue-i18n.  Side effects: none.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { catalogue } from '../catalogueText.js';
import { session } from '../session.js';

const { t } = useI18n();
// The folder a game is installed in, named in the empty-menu text.
const MODULES_FOLDER = 'modules';

// The games grouped by category, in order of first appearance: [{ key, games }].  The heading for each is looked up in
// the template (catalogue.categoryLabel), so it follows the language.
const groups = computed(() => {
  const byCategory = new Map();
  for (const game of session.games) {
    if (!byCategory.has(game.category)) byCategory.set(game.category, []);
    byCategory.get(game.category).push(game);
  }
  return [...byCategory].map(([key, games]) => ({ key, games }));
});

// Returns the player-count text for game `g`, e.g. '2 players' or '2–6 players'.
const players = (g) => (g.minPlayers === g.maxPlayers ? t('games.players', { count: g.maxPlayers }, g.maxPlayers) : t('games.playersRange', { min: g.minPlayers, max: g.maxPlayers }));
</script>

<template>
  <section class="stack">
    <h1>{{ t('games.welcome', { name: session.user.displayName }) }}</h1>
    <p class="muted">{{ t('games.choose') }}</p>

    <i18n-t v-if="!session.games.length" keypath="games.none" tag="p" class="panel">
      <template #folder><code>{{ MODULES_FOLDER }}</code></template>
    </i18n-t>

    <div v-for="group in groups" :key="group.key" class="stack">
      <h2>{{ catalogue.categoryLabel(group.key) }}</h2>
      <div class="grid">
        <RouterLink v-for="game in group.games" :key="game.id" :to="`/play/${game.id}`" class="game panel">
          <h3>{{ catalogue.gameName(game) }}</h3>
          <p class="muted">{{ catalogue.gameDescription(game) }}</p>
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
