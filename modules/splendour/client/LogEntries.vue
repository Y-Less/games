<script setup>
// The game log: the recent moves, newest first, with gems drawn in line.
// Props: entries (the log from the server view), you (your seat number, to highlight your own moves), nameOf (function: a
//   seat's name, which may be a message for an empty seat).
// Emits: none.  Slots: none (fills GameLog's default slot for each entry).
// Side effects: none.
// A line such as "took <gem><gem>" is one sentence with the gems drawn inside it, so it is written as one key with the
// gems as named slots (vue-i18n's <i18n-t>), never as words glued around them: a translator may put them anywhere.
import GameLog from '../../../src/components/GameLog.vue';
import { keyFor } from '../../../src/messageText.js';
import { useGameText } from '../../../src/useGameText.js';
import { CARD_BY_ID } from '../cards.js';
import { NOBLE_POINTS } from '../rules.js';
import Gem from './Gem.vue';

defineProps({
  entries: { type: Array, required: true },
  you: { type: Number, required: true },
  nameOf: { type: Function, required: true },
});
const { t, text, game } = useGameText();
// The full path of one of this game's keys, for <i18n-t>, which takes a key rather than the game's own `t`.
const key = (name) => keyFor(name, game);
// How many tokens a 'return' entry put back.
const returned = (give) => give.reduce((a, b) => a + b, 0);
</script>

<template>
  <GameLog :entries="entries" newest-first :empty="t('log.empty')" v-slot="{ entry: e }">
    <span class="move" :class="{ own: e.seat === you }">
      <span class="r">{{ t('log.round', { n: e.round }) }}</span>
      <b>{{ text(nameOf(e.seat)) }}</b>
      <i18n-t v-if="e.kind === 'take'" :keypath="key('log.took')" tag="span" scope="global">
        <template #gems><Gem v-for="(c, i) in e.colours" :key="i" :colour="c" :size="13" /></template>
      </i18n-t>
      <i18n-t v-else-if="e.kind === 'take2'" :keypath="key('log.tookTwo')" tag="span" scope="global">
        <template #gem><Gem :colour="e.colour" :size="13" /></template>
      </i18n-t>
      <i18n-t v-else-if="e.kind === 'reserve' && e.card" :keypath="key(e.gold ? 'log.reservedCardGold' : 'log.reservedCard')" tag="span" scope="global">
        <template #level>{{ e.level }}</template>
        <template #gem><Gem :colour="CARD_BY_ID[e.card].bonus" :size="13" /></template>
        <template #gold><Gem :colour="5" :size="13" /></template>
      </i18n-t>
      <i18n-t v-else-if="e.kind === 'reserve'" :keypath="key(e.gold ? 'log.reservedBlindGold' : 'log.reservedBlind')" tag="span" scope="global">
        <template #level>{{ e.level }}</template>
        <template #gold><Gem :colour="5" :size="13" /></template>
      </i18n-t>
      <i18n-t v-else-if="e.kind === 'buy'" :keypath="key(CARD_BY_ID[e.card].points ? 'log.boughtPoints' : 'log.bought')" tag="span" scope="global">
        <template #level>{{ e.level }}</template>
        <template #gem><Gem :colour="CARD_BY_ID[e.card].bonus" :size="13" /></template>
        <template #points>{{ CARD_BY_ID[e.card].points }}</template>
      </i18n-t>
      <template v-else-if="e.kind === 'return'">{{ t('log.returned', { count: returned(e.give) }, returned(e.give)) }}</template>
      <template v-else-if="e.kind === 'noble'">{{ t('log.noble', { name: t(`nobles.${e.noble}`), points: NOBLE_POINTS }) }}</template>
      <template v-else-if="e.kind === 'pass'">{{ t('log.passed') }}</template>
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
