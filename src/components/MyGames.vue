<script setup>
// File: the list of the games you have on the go, in every game of the site, with the way back into each.
// Depends on: vue, vue-router, vue-i18n, ../api.js, ../catalogueText.js, ../session.js.
// Props: none.  Emits: none.  Slots: none.
// Side effects: one GET of /api/my/games when it is put on screen.
//
// Nobody is held to one game, and a tournament is played over as long as its people like — a round one evening and
// the next another — so neither is something anybody is expected to leave open in a tab.  This is how you find your
// way back: it is asked for when the page opens rather than pushed over a socket, because a game set aside yesterday
// is a state to read, not an event you could have missed.
//
// It never moves anybody: every row is a link, as TourBand.vue and TournamentBoard.vue are, and the one that wants
// something from you says so rather than taking you there.
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { api } from '../api.js';
import { catalogue } from '../catalogueText.js';
import { session } from '../session.js';

const { t } = useI18n();
const rows = ref([]);
const loaded = ref(false);
// Told apart from an empty list on purpose: "you have no games" and "nobody could say" are different things to read,
// and the second one wrongly said as the first would send somebody away from a game that is sitting there waiting.
const failed = ref(false);

/** Is this row a tournament rather than a single game?  The two are told apart nowhere else in here. */
const isTournament = (row) => row.kind === 'tournament';

/**
 * What this row wants from the reader, which is the only reason the list is worth having on the page.  A tournament
 * may be waiting on them to be ready, or have a game of theirs open; an ordinary game is either still gathering its
 * people or being played.
 * @param {object} row  one game, as the server sends it
 * @returns {{ key: string, urgent: boolean }}  a full message key, since the two kinds draw on different words
 * Side effects: none.
 */
function standing(row) {
  // An ordinary game on this list is always one being played: the server sends no room that nobody has started.
  if (!isTournament(row)) return { key: 'games.beingPlayed', urgent: false };
  if (row.yourTable) return { key: 'tournament.yourGame', urgent: true };
  if (row.waiting && !row.youReady) return { key: 'tournament.needsYou', urgent: true };
  if (row.waiting) return { key: 'tournament.waitingForOthers', urgent: false };
  return { key: 'tournament.inPlay', urgent: false };
}

/** Where this row leads: the table a tournament has drawn you for when there is one, otherwise the room itself. */
const addressOf = (row) => `/play/${row.game}?${row.yourTable ?? row.code}`;

/** What the button on this row says: a tournament names what is waiting, a game simply carries on. */
const wayIn = (row) => (isTournament(row) ? (row.yourTable ? t('tournament.yourTable') : t('tournament.go')) : t('games.carryOn'));

/**
 * The second line of a row: how far a tournament has got, or who else is at a game — which is what tells two games of
 * the same thing apart, since their names never will.
 * @param {object} row  one game, as the server sends it
 * @returns {string}  the words, or '' when there is nothing to say (a lobby nobody else has reached yet)
 * Side effects: none.
 */
function about(row) {
  if (isTournament(row)) return t('tournament.round', { round: row.round, rounds: row.rounds });
  return row.others?.length ? t('games.with', { who: row.others.join(', ') }) : '';
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
    rows.value = [];
    failed.value = true;
  }
  loaded.value = true;
});
</script>

<template>
  <!-- Only what is worth coming back to is sent, so the list is simply what arrived.  Nothing is drawn until it has:
       a page that flickered "nothing on the go" and then filled would be worse than one that waited a moment. -->
  <section v-if="loaded" class="stack">
    <p v-if="failed" class="panel muted">{{ t('games.listUnavailable') }}</p>
    <p v-else-if="!rows.length" class="panel muted">{{ t('games.noneYours') }}</p>
    <ul v-else class="list">
      <li v-for="row in rows" :key="`${row.game}:${row.code}`" class="panel row entry" :class="{ urgent: standing(row).urgent }">
        <span class="what">
          <strong>{{ gameName(row) }}</strong>
          <span v-if="about(row)" class="muted">{{ about(row) }}</span>
          <span class="muted">{{ t(standing(row).key, { n: row.readyNow, of: row.readyOf }) }}</span>
        </span>
        <RouterLink class="button primary" :to="addressOf(row)">{{ wayIn(row) }}</RouterLink>
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
