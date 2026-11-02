<script setup>
// What each player nominated, took, and scored in one finished round.
// Props: round {Object, required} one entry of the view's `rounds` (label, bids, taken, deltas, instantWin);
// seats {Array, required} the seat objects (seat, name); you {Number} this player's seat, -1 for none.
// Emits: none.  Slots: none.  Side effects: none.
import { useGameText } from '../../../src/useGameText.js';

defineProps({
  round: { type: Object, required: true }, // one entry of the view's `rounds`
  seats: { type: Array, required: true },
  you: { type: Number, default: -1 },
});
const { t, text } = useGameText();
</script>

<template>
  <div class="result">
    <h3>{{ text(round.label) }}</h3>
    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{{ t('result.player') }}</th>
            <th scope="col">{{ t('result.nominated') }}</th>
            <th scope="col">{{ t('result.won') }}</th>
            <th scope="col">{{ t('result.points') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in seats" :key="s.seat" :class="{ me: s.seat === you, hit: round.bids[s.seat] === round.taken[s.seat] }">
            <th scope="row">{{ s.name }}<span v-if="s.seat === you" class="you"> {{ $t('common.youBracketed') }}</span></th>
            <td>{{ round.bids[s.seat] }}</td>
            <td>{{ round.taken[s.seat] }}</td>
            <td class="points">
              <strong>{{ round.deltas[s.seat] }}</strong>
              <small>{{ round.instantWin === s.seat ? t('result.instantWin') : round.bids[s.seat] === round.taken[s.seat] ? t('result.hit') : t('result.missed') }}</small>
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
