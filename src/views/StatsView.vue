<script setup>
// The statistics page: your totals, each game's figures and its leaderboard, and your recent games.
// Props: none. Emits: none. Slots: none.
// Depends on: api.js (GET /api/stats/me and /api/stats/leaderboard/<game>), session.js, catalogueText.js (game names and
// stat labels a language may translate), messageText.js (intlLocale) and StyledName.vue.
// Side effects: requests on mount.
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StyledName from '../components/StyledName.vue';
import { api } from '../api.js';
import { catalogue } from '../catalogueText.js';
import { intlLocale } from '../messageText.js';
import { session } from '../session.js';

const { t } = useI18n();
const stats = ref(null); // your stats once loaded
const failed = ref(''); // the error text if loading failed
const boards = ref({}); // game id -> leaderboard rows

// Loads your stats and then one leaderboard per game you have played. Side effects: sets stats, boards or failed.
onMounted(async () => {
  try {
    stats.value = await api('GET', '/api/stats/me');
    for (const game of stats.value.perGame) {
      boards.value[game.game] = (await api('GET', `/api/stats/leaderboard/${game.game}`)).leaderboard;
    }
  } catch (e) {
    failed.value = e.message;
  }
});

// Returns a number in the language's digits and grouping.
const number = (n) => n.toLocaleString(intlLocale());
// Returns a 0 to 1 fraction as a whole-number percentage, as the language writes one.
const percent = (n) => new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(n);
// Returns a timestamp (ms) as a date and time in the language.
const when = (ms) => new Date(ms).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });
// Returns the name of a game from a stats row ({ game: id, name }) in the language.
const gameName = (row) => catalogue.gameName({ id: row.game, name: row.name });
// Returns the won / lost (/ drawn) figures of a game as one line.
const record = (game) => (game.draws ? t('stats.wonLostDrawnValues', { wins: number(game.wins), losses: number(game.losses), draws: number(game.draws) }) : t('stats.wonLostValues', { wins: number(game.wins), losses: number(game.losses) }));
// Returns a recent game's player count, with its score when there is one ("4 players, 12 points").
function recentFacts(game) {
  const players = t('stats.players', { count: game.players }, game.players);
  if (game.score === null) return players;
  return t('stats.playersAndPoints', { players, points: t('stats.points', { count: game.score }, game.score) });
}
</script>

<template>
  <section class="stack stats">
    <h1>{{ t('stats.title', { name: session.user.displayName }) }}</h1>
    <p v-if="failed" class="panel" role="alert">{{ failed }}</p>
    <p v-else-if="!stats" class="muted">{{ t('common.loading') }}</p>

    <template v-else>
      <div class="totals">
        <div class="panel tile"><strong>{{ number(stats.summary.played) }}</strong><span class="muted">{{ t('stats.gamesPlayed') }}</span></div>
        <div class="panel tile"><strong>{{ number(stats.summary.wins) }}</strong><span class="muted">{{ t('stats.wins') }}</span></div>
        <div class="panel tile"><strong>{{ number(stats.summary.losses) }}</strong><span class="muted">{{ t('stats.losses') }}</span></div>
        <div v-if="stats.summary.draws" class="panel tile"><strong>{{ number(stats.summary.draws) }}</strong><span class="muted">{{ t('stats.draws') }}</span></div>
        <div class="panel tile"><strong>{{ percent(stats.summary.winRate) }}</strong><span class="muted">{{ t('stats.winRate') }}</span></div>
      </div>

      <p v-if="!stats.perGame.length" class="panel">{{ t('stats.none') }}</p>

      <div v-for="game in stats.perGame" :key="game.game" class="panel stack">
        <h2>{{ gameName(game) }}</h2>
        <table class="figures">
          <tbody>
            <tr><th>{{ t('stats.played') }}</th><td>{{ number(game.played) }}</td></tr>
            <tr><th>{{ game.draws ? t('stats.wonLostDrawn') : t('stats.wonLost') }}</th><td>{{ record(game) }}</td></tr>
            <tr><th>{{ t('stats.winRate') }}</th><td>{{ percent(game.winRate) }}</td></tr>
            <tr v-if="game.totalScore !== null"><th>{{ t('stats.totalScore') }}</th><td>{{ number(game.totalScore) }}</td></tr>
            <tr v-if="game.bestScore !== null"><th>{{ t('stats.bestScore') }}</th><td>{{ number(game.bestScore) }}</td></tr>
            <tr v-for="extra in game.extras.filter((e) => !e.hidden)" :key="extra.key"><th>{{ catalogue.statLabel(game.game, extra) }}</th><td>{{ number(extra.value) }}</td></tr>
          </tbody>
        </table>
        <template v-if="boards[game.game]?.length">
          <h3>{{ t('stats.mostWins') }}</h3>
          <ol class="board">
            <li v-for="row in boards[game.game]" :key="row.userId" :class="{ me: row.userId === session.user.id }">
              <StyledName :name="row.name" :user-id="row.userId" /> <span class="muted">{{ t('stats.wonFrom', { wins: number(row.wins), played: number(row.played) }) }}</span>
            </li>
          </ol>
        </template>
      </div>

      <div v-if="stats.recent.length" class="panel stack">
        <h2>{{ t('stats.recent') }}</h2>
        <table>
          <tbody>
            <tr v-for="(game, i) in stats.recent" :key="i">
              <td>{{ when(game.finishedAt) }}</td>
              <td>{{ gameName(game) }}</td>
              <td :class="game.outcome">{{ t(`stats.outcome.${game.outcome}`) }}</td>
              <td class="muted">{{ recentFacts(game) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.stats {
  max-width: 820px;
  margin: 0 auto;
}
.stats > h1 {
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.panel {
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
}
.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.7rem;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.tile strong {
  font-family: var(--display);
  font-size: 1.9rem;
  color: var(--amber);
}
table {
  width: 100%;
  border-collapse: collapse;
}
/* Every game's figures share the same two columns, whatever the labels and numbers are. */
.figures {
  table-layout: fixed;
}
.figures th {
  width: 65%;
}
th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
}
th,
td {
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--line);
}
.win {
  color: var(--moss);
}
.loss {
  color: var(--danger);
}
.board {
  margin: 0;
  padding-left: 1.4rem;
}
.board .me {
  color: var(--amber);
  font-weight: 600;
}
</style>
