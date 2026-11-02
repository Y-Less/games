<script setup>
// Final screen of Nomination Whist: winner banner, ranked standings and a host-only "Play again" button.
// Props: state {Object, required} the player's view of the finished game; send {Function, required} sends a request to the server.
// Emits: none (talks to the server via `send('again')`).
// Slots: none.
// Side effects: none locally; the button sends an 'again' request to the server.
import { computed } from 'vue';
import { placements } from '../../../shared/scores.js';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t, list } = useGameText();

// True when this player is the host (only they may restart).
const isHost = computed(() => props.state.hostSeat === props.state.you);
// Map of seat -> finishing place (1 = best). An instant winner is forced to first and the others are ranked below them.
const places = computed(() => {
  // Returns a seat -> place map for the given seats, ranked by score.
  const all = (seats) => placements(Object.fromEntries(seats.map((s) => [s.seat, s.score])));
  const win = props.state.instantWin;
  if (win === null || win === undefined) return all(props.state.seats);
  // The instant winner is first; the rest are ranked by their totals below them.
  const others = all(props.state.seats.filter((s) => s.seat !== win));
  return { ...Object.fromEntries(Object.entries(others).map(([seat, place]) => [seat, place + 1])), [win]: 1 };
});
// Seats ordered by place, ties broken by seat number, for display.
const standings = computed(() => [...props.state.seats].sort((a, b) => places.value[a.seat] - places.value[b.seat] || a.seat - b.seat));
// The seat objects that the server lists as winners (more than one means a tie).
const winners = computed(() => props.state.seats.filter((s) => props.state.winners.includes(s.seat)));
// The seat object of the instant winner, or null if the game was not won instantly.
const instantWinner = computed(() => props.state.seats.find((s) => s.seat === props.state.instantWin) ?? null);
// True when this player is among the winners.
const iWon = computed(() => props.state.winners.includes(props.state.you));
// A seat's name, with the site's "(you)" after it for your own, as the scoreboard writes it.
const named = (seat) => (seat.seat === props.state.you ? `${seat.name} ${t('common.youBracketed')}` : seat.name);
// The headline when the game was won on points: one winner, or a tie between several.
const outcome = computed(() => (winners.value.length === 1 ? t('scoreboard.wins', { name: winners.value[0].name }) : t('scoreboard.tie', { names: list(winners.value.map((w) => w.name)) })));
</script>

<template>
  <section class="panel stack final">
    <h2 v-if="instantWinner">{{ t('final.winsInstantly', { name: instantWinner.name }) }}</h2>
    <p v-if="instantWinner" class="muted instant">{{ t('final.instantExplain', { name: named(instantWinner) }) }}</p>
    <h2 v-else>{{ outcome }}</h2>
    <p v-if="iWon" class="muted">{{ t('final.youWon') }}</p>
    <ol class="standings">
      <li v-for="s in standings" :key="s.seat" class="row" :class="{ me: s.seat === state.you, win: places[s.seat] === 1 }">
        <span class="place">{{ places[s.seat] }}</span>
        <span class="name">{{ s.name }}<span v-if="s.seat === state.you" class="muted"> {{ $t('common.youBracketed') }}</span><span v-if="s.bot" class="muted"> {{ t('final.computer') }}</span></span>
        <strong>{{ s.score }}</strong>
      </li>
    </ol>
    <div class="row">
      <button v-if="isHost" class="primary" @click="send('again')">{{ t('table.playAgain') }}</button>
      <span v-else class="muted">{{ t('status.againHost') }}</span>
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
