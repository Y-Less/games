<script setup>
// The Leaderboard page: a folding panel for every game anybody has finished, each holding a table of its top ten
// players, with you added at the bottom when you are not one of them.  Props: none.  Emits: none.  Slots: none.
// Depends on: api.js (GET /api/leaderboard), session.js (which row is yours), catalogueText.js (game names a language
// may translate), messageText.js (intlLocale), CollapsiblePanel.vue and StyledName.vue.
// Side effects: one request on mount.
//
// The tables sort themselves.  The server sends the top of all three orders at once (server/stats.js standings), along
// with each row's position in each of them, so pressing a column heading rearranges what is already here: no request,
// and no waiting.  That is also why a row can be dropped or added by a sort: the ten best scorers are not the ten
// winningest, and you are always kept.
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.js';
import { catalogue } from '../catalogueText.js';
import { intlLocale } from '../messageText.js';
import { session } from '../session.js';
import CollapsiblePanel from '../components/CollapsiblePanel.vue';
import StyledName from '../components/StyledName.vue';

/**
 * The figure columns, in the order they are drawn.  `key` names both the figure on a row and that row's position in
 * the order sorted by it, so a heading, its cells, and the positions beside them cannot drift apart.
 */
const COLUMNS = [
  { key: 'played', label: 'leaderboard.played' },
  { key: 'wins', label: 'leaderboard.wins' },
  { key: 'bestScore', label: 'leaderboard.bestScore' },
];
/** The column every table starts out sorted by. */
const OPENS_ON = 'bestScore';

const { t } = useI18n();
const board = ref(null); // { top, games } once loaded (null while loading)
const failed = ref(''); // the error text if loading failed
const sorts = ref({}); // game id -> the column that game's table is sorted by, for the ones that have been changed

// Loads every game's standings.  Side effects: sets board, or failed.
onMounted(async () => {
  try {
    board.value = await api('GET', '/api/leaderboard');
  } catch (e) {
    failed.value = e.message;
  }
});

// Returns a number in the language's digits and grouping.
const number = (n) => n.toLocaleString(intlLocale());
// Returns the name of a game from a board ({ game: id, name }) in the language.
const gameName = (game) => catalogue.gameName({ id: game.game, name: game.name });
// Returns the column a game's table is sorted by.
const sortOf = (game) => sorts.value[game.game] ?? OPENS_ON;
// Sorts a game's table by a column.  Side effects: changes which rows that one table shows, and their order.
const sortBy = (game, column) => (sorts.value[game.game] = column);
// Returns a figure for a cell: a game nobody scores has no best score, which is a dash rather than a nought.
const figure = (row, key) => (row[key] === null ? t('leaderboard.noScore') : number(row[key]));

/**
 * The rows one game's table shows, in order: the top however-many in the order it is sorted by, and then you, when
 * you come further down than that.
 * @param {object} game  a board from the server
 * @returns {object[]} the rows to draw
 * Side effects: none.
 */
function rowsOf(game) {
  const column = sortOf(game);
  const rows = game.players.filter((p) => p.rank[column] <= board.value.top).sort((a, b) => a.rank[column] - b.rank[column]);
  const you = game.players.find((p) => p.userId === session.user.id);
  if (you && you.rank[column] > board.value.top) rows.push(you);
  return rows;
}
</script>

<template>
  <section class="stack leaderboard">
    <h1>{{ t('leaderboard.title') }}</h1>
    <p class="muted">{{ t('leaderboard.intro', { top: number(board?.top ?? 0) }) }}</p>
    <p v-if="failed" class="panel" role="alert">{{ failed }}</p>
    <p v-else-if="!board" class="muted">{{ t('common.loading') }}</p>
    <p v-else-if="!board.games.length" class="panel">{{ t('leaderboard.none') }}</p>

    <CollapsiblePanel v-for="game in board?.games ?? []" :key="game.game" :title="gameName(game)" :data-game="game.game">
      <template #summary>
        <span class="muted">{{ t('leaderboard.leads', { name: rowsOf(game)[0].name }) }}</span>
      </template>
      <div class="scroller">
        <table class="standings">
          <thead>
            <tr>
              <th scope="col" class="place">{{ t('leaderboard.position') }}</th>
              <th scope="col" class="who">{{ t('leaderboard.name') }}</th>
              <th v-for="column in COLUMNS" :key="column.key" scope="col" class="figure" :aria-sort="sortOf(game) === column.key ? 'descending' : 'none'">
                <button type="button" class="quiet sort" :class="{ on: sortOf(game) === column.key }" :aria-label="t('leaderboard.sortBy', { column: t(column.label) })" @click="sortBy(game, column.key)">{{ t(column.label) }}</button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rowsOf(game)" :key="row.userId" :class="{ me: row.userId === session.user.id }">
              <td class="place">{{ number(row.rank[sortOf(game)]) }}</td>
              <td class="who"><RouterLink :to="{ name: 'stats', params: { who: String(row.userId) } }"><StyledName :name="row.name" :user-id="row.userId" /></RouterLink></td>
              <td v-for="column in COLUMNS" :key="column.key" class="figure">{{ figure(row, column.key) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </CollapsiblePanel>
  </section>
</template>

<style scoped>
.leaderboard {
  max-width: 820px;
  margin: 0 auto;
}
.leaderboard > h1 {
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.panel {
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
}
/* Five columns do not fit across a phone, so the table slides sideways inside its own panel rather than shoving the
   whole page about. */
.scroller {
  overflow-x: auto;
}
.standings {
  width: 100%;
  min-width: 25rem;
  border-collapse: collapse;
}
th,
td {
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
th {
  font-weight: 500;
  color: var(--muted);
}
.place,
.figure {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.place {
  width: 3.5rem;
}
/* A name on one line: with five columns to fit, two-line names make a table nobody can read down. */
.who {
  white-space: nowrap;
}
/* The headings that sort are buttons, so the site's own button styling has to be kept off them in every state. */
.sort {
  padding: 0;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.sort:hover,
.sort:focus,
.sort:focus-visible {
  color: var(--amber);
  background: none;
  border: 0;
  box-shadow: none;
}
.sort.on {
  color: var(--amber);
  text-decoration: underline solid;
}
tbody .me {
  color: var(--amber);
  font-weight: 600;
}
td a {
  color: inherit;
  text-decoration: none;
}
td a:hover,
td a:focus-visible {
  text-decoration: underline;
}
</style>
