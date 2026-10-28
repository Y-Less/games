<script setup>
// Every round's scores in a table, with totals. Standard shape: see shared/scores.js.
import { computed } from 'vue';
import { placements } from '../../shared/scores.js';

const props = defineProps({
  players: { type: Array, required: true }, // [{ id, name, score, isMe? }]
  rounds: { type: Array, default: () => [] }, // [{ label, deltas: { [id]: points }, notes?: { [id]: text } }]
  lowIsBetter: { type: Boolean, default: false },
  target: { type: Number, default: null },
  running: { type: Boolean, default: false }, // show the running total beside each round's points
  split: { type: Boolean, default: false }, // two columns per player: the round's points, then the running total (notes go below both)
});

const places = computed(() => placements(Object.fromEntries(props.players.map((p) => [p.id, p.score])), { lowIsBetter: props.lowIsBetter }));

/** Cumulative totals after each round. */
const runningTotals = computed(() => {
  const sums = Object.fromEntries(props.players.map((p) => [p.id, 0]));
  return props.rounds.map((round) => {
    for (const p of props.players) sums[p.id] += round.deltas?.[p.id] ?? 0;
    return { ...sums };
  });
});

const hasNotes = (round) => props.players.some((p) => round.notes?.[p.id]);

/** Which players had the best score in a round (they are highlighted). */
function best(round) {
  const values = props.players.map((p) => round.deltas?.[p.id] ?? 0);
  const top = props.lowIsBetter ? Math.min(...values) : Math.max(...values);
  return new Set(props.players.filter((p) => (round.deltas?.[p.id] ?? 0) === top && values.some((v) => v !== top)).map((p) => p.id));
}

function ordinal(n) {
  const teen = n % 100 > 10 && n % 100 < 14;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
}

const sign = (n) => (n > 0 && props.lowIsBetter === false ? `+${n}` : String(n));
</script>

<template>
  <div class="score-table-wrap">
    <table class="score-table">
      <thead>
        <tr>
          <th scope="col">Round</th>
          <th v-for="p in players" :key="p.id" scope="col" :colspan="split ? 2 : undefined" :class="{ me: p.isMe }">{{ p.name }}<span v-if="p.isMe" class="you"> (you)</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!rounds.length">
          <td :colspan="players.length * (split ? 2 : 1) + 1" class="muted empty">No rounds finished yet.</td>
        </tr>
        <template v-for="(round, i) in rounds" :key="i">
          <tr v-if="split" class="split-row" :class="{ noted: hasNotes(round) }">
            <th scope="row" :rowspan="hasNotes(round) ? 2 : undefined">{{ round.label }}</th>
            <template v-for="p in players" :key="p.id">
              <td class="points" :class="{ top: best(round).has(p.id), me: p.isMe }">{{ sign(round.deltas?.[p.id] ?? 0) }}</td>
              <td class="total muted" :class="{ me: p.isMe }">{{ runningTotals[i][p.id] }}</td>
            </template>
          </tr>
          <tr v-if="split && hasNotes(round)" class="notes-row">
            <td v-for="p in players" :key="p.id" colspan="2" :class="{ me: p.isMe }">
              <small v-if="round.notes?.[p.id]" class="note muted">{{ round.notes[p.id] }}</small>
            </td>
          </tr>
          <tr v-else-if="!split">
            <th scope="row">{{ round.label }}</th>
            <td v-for="p in players" :key="p.id" :class="{ top: best(round).has(p.id), me: p.isMe }" :title="round.notes?.[p.id]">
              {{ sign(round.deltas?.[p.id] ?? 0) }}<span v-if="running" class="run muted"> ({{ runningTotals[i][p.id] }})</span>
              <small v-if="round.notes?.[p.id]" class="note muted">{{ round.notes[p.id] }}</small>
            </td>
          </tr>
        </template>
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total<span v-if="target" class="muted"> / {{ target }}</span></th>
          <td v-for="p in players" :key="p.id" :colspan="split ? 2 : undefined" :class="{ leader: places[p.id] === 1, me: p.isMe }">
            <strong>{{ p.score }}</strong>
            <small class="place muted">{{ places[p.id] === 1 ? 'leading' : ordinal(places[p.id]) }}</small>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
.score-table-wrap {
  overflow-x: auto;
}
.score-table {
  width: 100%;
  border-collapse: collapse;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
th,
td {
  min-width: 4.5rem; /* on a narrow screen the table scrolls sideways rather than squeezing the notes */
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
thead th {
  color: var(--parchment);
  font-weight: 600;
  white-space: nowrap;
}
tbody th,
tfoot th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
  position: sticky;
  left: 0;
  background: var(--bg-raised);
}
.me {
  background: color-mix(in srgb, var(--amber) 10%, transparent);
}
.you {
  color: var(--amber);
  font-weight: 400;
}
.top {
  color: var(--moss);
  font-weight: 600;
}
tfoot td {
  border-top: 2px solid var(--line);
  font-size: 1.15rem;
}
.leader strong {
  color: var(--amber);
}
small {
  display: block;
  font-size: 0.72rem;
  line-height: 1.2;
}
.run {
  font-size: 0.8rem;
}
/* Two columns per player, both the usual column width; the running total is dimmer (muted) than the points. */
.split-row .points {
  padding-right: 0.3rem;
}
.split-row .total {
  padding-left: 0.3rem;
}
/* A round with notes: the row and its notes read as one, so the line goes under the notes. */
.split-row.noted th,
.split-row.noted td {
  border-bottom: 0;
}
.notes-row td {
  min-width: 0;
  padding-top: 0;
}
.empty {
  text-align: center;
  padding: 1rem;
}
</style>
