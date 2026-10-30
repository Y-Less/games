<script setup>
import { onMounted, ref } from 'vue';
import StyledName from '../components/StyledName.vue';
import { api, session } from '../session.js';

const stats = ref(null);
const failed = ref('');
const boards = ref({}); // game id -> leaderboard rows

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

const percent = (n) => `${Math.round(n * 100)}%`;
const when = (ms) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const outcomeLabel = { win: 'Won', loss: 'Lost', draw: 'Drew' };
</script>

<template>
  <section class="stack stats">
    <h1>Statistics for {{ session.user.displayName }}</h1>
    <p v-if="failed" class="panel" role="alert">{{ failed }}</p>
    <p v-else-if="!stats" class="muted">Loading…</p>

    <template v-else>
      <div class="totals">
        <div class="panel tile"><strong>{{ stats.summary.played }}</strong><span class="muted">Games played</span></div>
        <div class="panel tile"><strong>{{ stats.summary.wins }}</strong><span class="muted">Wins</span></div>
        <div class="panel tile"><strong>{{ stats.summary.losses }}</strong><span class="muted">Losses</span></div>
        <div v-if="stats.summary.draws" class="panel tile"><strong>{{ stats.summary.draws }}</strong><span class="muted">Draws</span></div>
        <div class="panel tile"><strong>{{ percent(stats.summary.winRate) }}</strong><span class="muted">Win rate</span></div>
      </div>

      <p v-if="!stats.perGame.length" class="panel">You haven't finished a game yet. Go and play one!</p>

      <div v-for="game in stats.perGame" :key="game.game" class="panel stack">
        <h2>{{ game.name }}</h2>
        <table>
          <tbody>
            <tr><th>Played</th><td>{{ game.played }}</td></tr>
            <tr><th>Won / lost<span v-if="game.draws"> / drawn</span></th><td>{{ game.wins }} / {{ game.losses }}<span v-if="game.draws"> / {{ game.draws }}</span></td></tr>
            <tr><th>Win rate</th><td>{{ percent(game.winRate) }}</td></tr>
            <tr v-if="game.totalScore !== null"><th>Total score</th><td>{{ game.totalScore }}</td></tr>
            <tr v-if="game.bestScore !== null"><th>Best score</th><td>{{ game.bestScore }}</td></tr>
            <tr v-for="extra in game.extras" :key="extra.key"><th>{{ extra.label }}</th><td>{{ extra.value }}</td></tr>
          </tbody>
        </table>
        <template v-if="boards[game.game]?.length">
          <h3>Most wins</h3>
          <ol class="board">
            <li v-for="row in boards[game.game]" :key="row.userId" :class="{ me: row.userId === session.user.id }">
              <StyledName :name="row.name" :user-id="row.userId" /> <span class="muted">{{ row.wins }} won from {{ row.played }}</span>
            </li>
          </ol>
        </template>
      </div>

      <div v-if="stats.recent.length" class="panel stack">
        <h2>Recent games</h2>
        <table>
          <tbody>
            <tr v-for="(game, i) in stats.recent" :key="i">
              <td>{{ when(game.finishedAt) }}</td>
              <td>{{ game.name }}</td>
              <td :class="game.outcome">{{ outcomeLabel[game.outcome] }}</td>
              <td class="muted">{{ game.players }} players<span v-if="game.score !== null">, {{ game.score }} points</span></td>
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
