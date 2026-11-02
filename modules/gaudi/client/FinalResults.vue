<script setup>
// The end of the game: who won and a table breaking every player's score down, with the rules for private objectives and ties.
// It scrolls inside itself if it is too big, so the page never grows. Attributes from the parent (the grid column) land on the box.
// Props: state (the server's view, finished), winners (the winners' names).
// Emits: again (the host asks for another game), scores (open the score board pop-up). Side effects: none.
import { COLOUR_HEX } from './glyphs.js';
import { useGameText } from '../../../src/useGameText.js';
import { rank } from './wording.js';

defineProps({ state: { type: Object, required: true }, winners: { type: Array, required: true } });
const emit = defineEmits(['again', 'scores']);
const { t, text, list } = useGameText();
</script>

<template>
  <section class="final">
    <h3>{{ t(winners.length > 1 ? 'final.shared' : 'final.winner') }}</h3>
    <p class="winner">{{ t('final.result', { names: list(winners), points: state.final.players[state.winners[0]].total }, winners.length) }}</p>
    <div class="table-scroll">
      <table class="breakdown">
        <thead>
          <tr>
            <th scope="col">{{ t('final.player') }}</th>
            <th v-for="o in state.publicObjectives" :key="o.id" scope="col">{{ t(`objectives.${o.id}.name`) }}</th>
            <th scope="col">{{ t('final.private') }}</th>
            <th scope="col">{{ t('final.tokens') }}</th>
            <th scope="col">{{ t('final.empty') }}</th>
            <th scope="col">{{ $t('scoreboard.total') }}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in state.final.players" :key="row.seat" :class="{ win: state.winners.includes(row.seat), me: row.seat === state.you }">
            <th scope="row">{{ text(row.name) }}<span v-if="row.seat === state.you" class="muted"> {{ $t('common.youBracketed') }}</span></th>
            <td v-for="p in row.publics" :key="p.id">{{ p.points }}<small class="muted"> ({{ p.sets }})</small></td>
            <td>
              <span class="dot" :style="{ background: COLOUR_HEX[row.privateColour] }" />{{ t(`colours.${row.privateColour}`) }}: <strong>{{ row.privatePoints }}</strong>
            </td>
            <td>+{{ row.tokens }}</td>
            <td>-{{ row.empty }}</td>
            <td><strong>{{ row.total }}</strong></td>
            <td>{{ rank(t, row) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted small">{{ t('final.ruleNote', { rule: t(state.badPrivate ? 'final.ruleBad' : 'final.ruleNormal') }) }}</p>
    <div class="row">
      <button v-if="state.hostSeat === state.you" class="primary" @click="emit('again')">{{ t('final.playAgain') }}</button>
      <span v-else class="muted">{{ t('final.hostAgain') }}</span>
      <button @click="emit('scores')">{{ t('final.seeScores') }}</button>
    </div>
  </section>
</template>

<style scoped>
.small {
  font-size: 0.85rem;
  margin: 0;
}
.final {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
}
.final h3 {
  margin: 0;
}
.winner {
  margin: 0;
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
}
.table-scroll {
  overflow-x: auto;
}
.breakdown {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.9rem;
}
.breakdown th,
.breakdown td {
  padding: 0.3rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--line);
  vertical-align: baseline;
}
.breakdown thead th {
  font-size: 0.8rem;
  color: var(--muted);
  font-weight: 500;
}
.breakdown tr.win {
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}
.dot {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 3px;
  margin-right: 0.35rem;
}
</style>
