<script setup>
// How a round ended: who won and why, and every player's leftover tiles (public once the round is over).
import { computed } from 'vue';
import Tile from './Tile.vue';

const props = defineProps({
  lastRound: { type: Object, required: true }, // lastRound from the view
  seats: { type: Array, required: true },
  settings: { type: Object, required: true },
  you: { type: Number, default: -1 },
});
const headline = computed(() => {
  const names = props.lastRound.winners.map((w) => props.seats[w]?.name ?? 'Someone').join(' and ');
  return props.lastRound.reason === 'out' ? `${names} went out.` : `Nobody could play. ${names} had the lowest rack.`;
});
const signed = (n) => (n > 0 ? `+${n}` : String(n));
</script>

<template>
  <div class="summary" role="group" :aria-label="`Round ${lastRound.round}`">
    <h4>Round {{ lastRound.round }}</h4>
    <p class="headline">{{ headline }}</p>
    <ul>
      <li v-for="(rack, seat) in lastRound.racks" :key="seat" :class="{ me: seat === you, won: lastRound.winners.includes(seat) }">
        <strong class="name">{{ seats[seat]?.name }}</strong>
        <span class="rack">
          <Tile v-for="id in rack" :key="id" :settings="settings" :id="id" size="sm" :interactive="false" />
          <span v-if="!rack.length" class="muted">no tiles left</span>
        </span>
        <span class="total muted">{{ lastRound.totals[seat] }} points of tiles</span>
        <b class="delta">{{ signed(lastRound.deltas[seat]) }}</b>
      </li>
    </ul>
  </div>
</template>

<style scoped>
h4 {
  margin: 0 0 0.3rem;
}
.headline {
  margin: 0 0 0.6rem;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
li {
  display: grid;
  grid-template-columns: 8rem 1fr auto 4rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.6rem;
  border-radius: 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
li.won {
  border-color: var(--moss);
}
li.me .name::after {
  content: ' (you)';
  font-weight: 400;
  color: var(--muted);
}
.rack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
.delta {
  text-align: right;
}
</style>
