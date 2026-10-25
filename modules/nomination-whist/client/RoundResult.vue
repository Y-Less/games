<script setup>
// What each player nominated, took and scored in one finished round.
defineProps({
  round: { type: Object, required: true }, // one entry of the view's `rounds`
  seats: { type: Array, required: true },
  you: { type: Number, default: -1 },
});
</script>

<template>
  <div class="result">
    <h3>{{ round.label }}</h3>
    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Nominated</th>
            <th scope="col">Won</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in seats" :key="s.seat" :class="{ me: s.seat === you, hit: round.bids[s.seat] === round.taken[s.seat] }">
            <th scope="row">{{ s.name }}<span v-if="s.seat === you" class="you"> (you)</span></th>
            <td>{{ round.bids[s.seat] }}</td>
            <td>{{ round.taken[s.seat] }}</td>
            <td class="points">
              <strong>{{ round.deltas[s.seat] }}</strong>
              <small>{{ round.instantWin === s.seat ? 'instant win!' : round.bids[s.seat] === round.taken[s.seat] ? 'exactly right' : 'missed' }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.result {
  margin-bottom: 0.8rem;
}
h3 {
  color: var(--amber);
  margin-bottom: 0.4rem;
}
.wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
th,
td {
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--line);
}
thead th {
  color: var(--muted);
  font-weight: 500;
  font-size: 0.85rem;
}
tbody th {
  text-align: left;
  font-weight: 600;
}
.me {
  background: color-mix(in srgb, var(--amber) 10%, transparent);
}
.you {
  color: var(--amber);
  font-weight: 400;
}
.hit .points strong {
  color: var(--moss);
}
.points small {
  display: block;
  font-size: 0.72rem;
  color: var(--muted);
}
</style>
