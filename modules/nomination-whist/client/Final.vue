<script setup>
import { computed } from 'vue';
import { placements } from '../../../shared/scores.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const isHost = computed(() => props.state.hostSeat === props.state.you);
const places = computed(() => {
  const all = (seats) => placements(Object.fromEntries(seats.map((s) => [s.seat, s.score])));
  const win = props.state.instantWin;
  if (win === null || win === undefined) return all(props.state.seats);
  // The instant winner is first; the rest are ranked by their totals below them.
  const others = all(props.state.seats.filter((s) => s.seat !== win));
  return { ...Object.fromEntries(Object.entries(others).map(([seat, place]) => [seat, place + 1])), [win]: 1 };
});
const standings = computed(() => [...props.state.seats].sort((a, b) => places.value[a.seat] - places.value[b.seat] || a.seat - b.seat));
const winners = computed(() => props.state.seats.filter((s) => props.state.winners.includes(s.seat)));
const instantWinner = computed(() => props.state.seats.find((s) => s.seat === props.state.instantWin) ?? null);
const iWon = computed(() => props.state.winners.includes(props.state.you));
</script>

<template>
  <section class="panel stack final">
    <h2 v-if="instantWinner">{{ instantWinner.name }} wins instantly!</h2>
    <p v-if="instantWinner" class="muted instant">{{ instantWinner.name }}{{ instantWinner.seat === state.you ? ' (you)' : '' }} nominated 7 and won all 7 tricks, so the game ends here whatever the totals. Everyone else is ranked by their scores so far.</p>
    <h2 v-else>{{ winners.length === 1 ? `${winners[0].name} wins!` : `A tie: ${winners.map((w) => w.name).join(' and ')}` }}</h2>
    <p v-if="iWon" class="muted">Well played: that is a win for you.</p>
    <ol class="standings">
      <li v-for="s in standings" :key="s.seat" class="row" :class="{ me: s.seat === state.you, win: places[s.seat] === 1 }">
        <span class="place">{{ places[s.seat] }}</span>
        <span class="name">{{ s.name }}<span v-if="s.seat === state.you" class="muted"> (you)</span><span v-if="s.bot" class="muted"> (computer)</span></span>
        <strong>{{ s.score }}</strong>
      </li>
    </ol>
    <div class="row">
      <button v-if="isHost" class="primary" @click="send('again')">Play again</button>
      <span v-else class="muted">The host can start another game.</span>
      <button class="quiet" @click="send('leave')">Leave game</button>
    </div>
  </section>
</template>

<style scoped>
.final h2 {
  color: var(--amber);
}
.standings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.standings li {
  flex-wrap: nowrap;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
}
.standings li.me {
  border-color: var(--amber);
}
.place {
  width: 1.6rem;
  font-family: var(--display);
  color: var(--muted);
}
.win .place,
.win strong {
  color: var(--amber);
}
.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
