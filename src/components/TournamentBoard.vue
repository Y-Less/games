<script setup>
// File: a tournament while it is being played, and when it is over.  Depends on: Vue only.
//
// This is what the room a tournament is run from shows, in place of the game's table: this round's games and who is
// at them, the way into your own, and how everybody stands.  Nothing is played here.
//
// It never moves anybody by itself.  Being pulled out of a game you were still reading the end of would be worse
// than having to click, which is the same rule TourBand.vue keeps.
//
// Props: tournament (the `tournament` block of the state), busy (Boolean).
// Emits: go(code) — walk into that game.  The parent sends it as a join.
// Side effects: none itself; only emits.
import { computed } from 'vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  tournament: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});
const { t } = useGameText();
const emit = defineEmits(['go']);

const over = computed(() => props.tournament.phase === 'finished');
/** This round's games, or the round just played once the tournament is over. */
const games = computed(() => (over.value ? props.tournament.last : props.tournament.tables));
/** Nobody drew this person a game this round: with an odd number, somebody has to sit one out. */
const sittingOut = computed(() => !over.value && games.value.length > 0 && !games.value.some((table) => table.yours));
</script>

<template>
  <section class="panel stack">
    <h2>{{ t('tournament.title') }}</h2>
    <p v-if="over" class="muted">{{ t('tournament.over') }}</p>
    <p v-else class="muted">{{ t('tournament.round', { round: props.tournament.round, rounds: props.tournament.rounds }) }}</p>

    <div v-if="props.tournament.yourTable" class="row">
      <button class="primary" :disabled="props.busy" @click="emit('go', props.tournament.yourTable)">{{ t('tournament.yourTable') }}</button>
    </div>
    <p v-else-if="sittingOut" class="muted">{{ t('tournament.sittingOut') }}</p>
    <p v-else-if="!over" class="muted">{{ t('tournament.waiting') }}</p>
  </section>

  <section v-if="games.length" class="panel stack">
    <h3>{{ over ? t('tournament.lastRound') : t('tournament.thisRound') }}</h3>
    <ul class="tables">
      <li v-for="table in games" :key="table.code ?? table.players.map((p) => p.id).join('-')" class="table" :class="{ yours: table.yours, done: table.done }">
        <span class="who">{{ table.players.map((player) => player.name).join(' — ') }}</span>
        <span v-if="table.failed" class="muted">{{ t('tournament.unfinished') }}</span>
        <span v-else-if="table.done" class="muted">{{ t('tournament.played') }}</span>
        <span v-else class="muted">{{ t('tournament.playing') }}</span>
      </li>
    </ul>
  </section>

  <section class="panel stack">
    <h3>{{ t('tournament.standings') }}</h3>
    <table class="standings">
      <thead>
        <tr>
          <th scope="col">{{ t('tournament.place') }}</th>
          <th scope="col">{{ t('tournament.player') }}</th>
          <th scope="col">{{ t('tournament.won') }}</th>
          <th scope="col">{{ t('tournament.gamesPlayed') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in props.tournament.standings" :key="row.id">
          <td>{{ row.place }}</td>
          <td>{{ row.name }}</td>
          <td>{{ row.wins }}</td>
          <td>{{ row.played }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.tables {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.table {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  border-radius: 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
.table.yours {
  border-color: var(--amber);
}
.table.done {
  opacity: 0.7;
}
.standings {
  width: 100%;
  border-collapse: collapse;
}
.standings th,
.standings td {
  text-align: left;
  padding: 0.3rem 0.6rem 0.3rem 0;
}
.standings tbody tr + tr {
  border-top: 1px solid var(--line);
}
</style>
