<script setup>
// File: a tournament while it is being played, and when it is over.  Depends on: Vue only.
//
// This is what the room a tournament is run from shows, in place of the game's table: this round's games and who is
// at them, the way into your own, and how everybody stands.  Nothing is played here.
//
// It never moves anybody by itself.  Being pulled out of a game you were still reading the end of would be worse
// than having to click, which is the same rule TourBand.vue keeps.
//
// Props: tournament (the `tournament` block of the state), busy (Boolean), isHost (Boolean).
// Emits: go(code) — walk into that game; ready(on) — say you are ready for the next round, or take it back;
// kick(slot) — the host puts somebody out.  The parent sends them.
// Side effects: none itself; only emits.
import { computed } from 'vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  tournament: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  isHost: { type: Boolean, default: false },
});
const { t } = useGameText();
const emit = defineEmits(['go', 'ready', 'kick']);

/** Between rounds: the next one opens once everybody still here has said they are ready for it. */
const waiting = computed(() => Boolean(props.tournament.waiting));
/** Everybody who has not said so yet, as the ones still here are named. */
const notReady = computed(() => props.tournament.notReady ?? []);
/** The slot of somebody still being waited for, so the host can put them out; they may not be in the room at all. */
const slotOf = (id) => props.tournament.entrants?.find((person) => person.id === id)?.slot ?? null;

const over = computed(() => props.tournament.phase === 'finished');
/** This round's games, or the round just played once the tournament is over. */
const games = computed(() => (over.value ? props.tournament.last : props.tournament.tables));
// Nobody drew this person a game this round.  In pairs that is the odd one out; at larger tables it is however many
// are left over once the round's games are made up, which can be more than one of them.  Everybody sits out the same
// number of rounds in the end, since every person is in the same number of combinations.

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
    <template v-else-if="waiting">
      <p class="muted">{{ t('tournament.readyExplain') }}</p>
      <div class="row">
        <button v-if="!props.tournament.youReady" class="primary" :disabled="props.busy" @click="emit('ready', true)">{{ t('tournament.readyUp') }}</button>
        <button v-else class="quiet" :disabled="props.busy" @click="emit('ready', false)">{{ t('tournament.notYet') }}</button>
        <span class="muted">{{ t('tournament.readyCount', { n: props.tournament.readyNow, of: props.tournament.readyOf }) }}</span>
      </div>
      <ul v-if="notReady.length" class="waiting-for">
        <li v-for="person in notReady" :key="person.id">
          <span>{{ person.name }}</span>
          <button v-if="props.isHost && slotOf(person.id) !== null" class="quiet" :disabled="props.busy" @click="emit('kick', slotOf(person.id))">{{ t('common.remove') }}</button>
        </li>
      </ul>
    </template>
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
.tables,
.waiting-for {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.waiting-for li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.3rem 0.8rem;
  border-radius: 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
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
