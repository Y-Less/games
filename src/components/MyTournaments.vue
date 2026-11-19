<script setup>
// File: the list of the tournaments you are in, across every game, with the way back into each.
// Depends on: vue, vue-router, vue-i18n, ../api.js, ../catalogueText.js, ../session.js.
// Props: none.  Emits: none.  Slots: none.
// Side effects: one GET of /api/my/games when it is put on screen.
//
// A tournament is played over as long as its people like — a round one evening and the next another — so the room it
// is run from is not something anybody is expected to leave open in a tab.  This is how you find your way back to it:
// it is asked for when the page opens rather than pushed over a socket, because a round that has been waiting since
// yesterday is a state to read, not an event you could have missed.
//
// It never moves anybody: every row is a link, as TourBand.vue and TournamentBoard.vue are, and the one that wants
// something from you says so rather than taking you there.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { api } from '../api.js';
import { catalogue } from '../catalogueText.js';
import { session } from '../session.js';

const { t } = useI18n();
const rows = ref([]);
const loaded = ref(false);

// The site's list holds every game a person has on the go; this screen draws the tournaments among them, until it
// grows into the list of all of them.  (One that is over is not sent at all: it has nothing to come back for.)
const mine = computed(() => rows.value.filter((row) => row.kind === 'tournament'));

/**
 * What this tournament wants from the reader, which is the only reason the list is worth having on the page:
 * a game of theirs is open, it is waiting on them, or it is waiting on somebody else.
 * @param {object} row  one tournament, as the server sends it
 * @returns {{ key: string, urgent: boolean }}
 * Side effects: none.
 */
function standing(row) {
  if (row.yourTable) return { key: 'yourGame', urgent: true };
  if (row.waiting && !row.youReady) return { key: 'needsYou', urgent: true };
  if (row.waiting) return { key: 'waitingForOthers', urgent: false };
  return { key: 'inPlay', urgent: false };
}

/** The game's name in the reader's language, or the one the server gave when the site does not know it. */
const gameName = (row) => {
  const meta = session.games?.find((game) => game.id === row.game);
  return meta ? catalogue.gameName(meta) : row.name;
};

onMounted(async () => {
  try {
    const reply = await api('GET', '/api/my/games');
    rows.value = Array.isArray(reply?.games) ? reply.games : [];
  } catch {
    rows.value = []; // the list is a convenience: a page that cannot fetch it still shows every game
  }
  loaded.value = true;
});
</script>

<template>
  <section v-if="loaded && mine.length" class="stack">
    <h2>{{ t('tournament.mine') }}</h2>
    <ul class="list">
      <li v-for="row in mine" :key="`${row.game}:${row.code}`" class="panel row entry" :class="{ urgent: standing(row).urgent }">
        <span class="what">
          <strong>{{ gameName(row) }}</strong>
          <span class="muted">{{ t('tournament.round', { round: row.round, rounds: row.rounds }) }}</span>
          <span class="muted">{{ t(`tournament.${standing(row).key}`, { n: row.readyNow, of: row.readyOf }) }}</span>
        </span>
        <RouterLink class="button primary" :to="`/play/${row.game}?${row.yourTable ?? row.code}`">
          {{ row.yourTable ? t('tournament.yourTable') : t('tournament.go') }}
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.entry {
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.9rem;
}
.entry.urgent {
  border-color: var(--amber);
}
.what {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.6rem;
  min-width: 0;
}
</style>
