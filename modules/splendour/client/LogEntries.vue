<script setup>
// The game log: the recent moves, newest first, with gems drawn in line.
// Props: entries (the log from the server view), you (your seat number, to highlight your own moves), nameOf (function: a
//   seat's name).
// Emits: none.
// Side effects: none.
import GameLog from '../../../src/components/GameLog.vue';
import { CARD_BY_ID, NOBLE_BY_ID } from '../cards.js';
import { NOBLE_POINTS } from '../rules.js';
import Gem from './Gem.vue';

defineProps({
  entries: { type: Array, required: true },
  you: { type: Number, required: true },
  nameOf: { type: Function, required: true },
});
</script>

<template>
  <GameLog :entries="entries" newest-first empty="Nothing has happened yet." v-slot="{ entry: e }">
    <span class="move" :class="{ own: e.seat === you }">
      <span class="r">R{{ e.round }}</span>
      <b>{{ nameOf(e.seat) }}</b>
      <template v-if="e.kind === 'take'">
        took <Gem v-for="c in e.colours" :key="c" :colour="c" :size="13" />
      </template>
      <template v-else-if="e.kind === 'take2'">took two <Gem :colour="e.colour" :size="13" /></template>
      <template v-else-if="e.kind === 'reserve'">
        reserved
        <template v-if="e.card">a level {{ e.level }} card <Gem :colour="CARD_BY_ID[e.card].bonus" :size="13" /></template>
        <template v-else>the top card of pile {{ e.level }}</template>
        <template v-if="e.gold"> and took <Gem :colour="5" :size="13" /></template>
      </template>
      <template v-else-if="e.kind === 'buy'">
        bought a level {{ e.level }} card <Gem :colour="CARD_BY_ID[e.card].bonus" :size="13" /><template v-if="CARD_BY_ID[e.card].points"> (+{{ CARD_BY_ID[e.card].points }})</template>
      </template>
      <template v-else-if="e.kind === 'return'">returned {{ e.give.reduce((a, b) => a + b, 0) }} tokens</template>
      <template v-else-if="e.kind === 'noble'">was visited by {{ NOBLE_BY_ID[e.noble].name }} (+{{ NOBLE_POINTS }})</template>
      <template v-else-if="e.kind === 'pass'">passed</template>
    </span>
  </GameLog>
</template>

<style scoped>
.move {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--muted);
}
.move :deep(.gem) {
  vertical-align: middle;
  margin: 0 1px;
}
.move b {
  margin-right: 0.25em;
}
.move.own {
  color: var(--parchment);
}
.move.own b {
  color: var(--amber);
}
.move .r {
  font-size: 0.8em;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 0.25em;
  margin-right: 0.3em;
}
</style>
