<script setup>
// How a round ended: who won and why, and every player's leftover tiles (public once the round is over).
// Props: lastRound (the view's summary of the round: winners, reason, and the final racks), seats (all seats, for names),
//   settings (the tile settings), you (your seat number, or -1 for a spectator).
// Emits: none.  Slots: none.  Side effects: none.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import Tile from './Tile.vue';

const props = defineProps({
  lastRound: { type: Object, required: true }, // lastRound from the view
  seats: { type: Array, required: true },
  settings: { type: Object, required: true },
  you: { type: Number, default: -1 },
});
const { t, text, list } = useGameText();
// The sentence saying who won the round and how (went out, or lowest rack when nobody could play).
const headline = computed(() => {
  const names = list(props.lastRound.winners.map((w) => text(props.seats[w]?.name ?? { key: 'common.someone' })));
  return t(props.lastRound.reason === 'out' ? 'summary.wentOut' : 'summary.blocked', { names });
});
// Formats a score change with an explicit plus sign for gains ("+5", "-12", "0").
const signed = (n) => (n > 0 ? `+${n}` : String(n));
</script>

<template>
  <div class="summary" role="group" :aria-label="t('round', { n: lastRound.round })">
    <h4>{{ t('round', { n: lastRound.round }) }}</h4>
    <p class="headline">{{ headline }}</p>
    <ul>
      <li v-for="(rack, seat) in lastRound.racks" :key="seat" :class="{ me: seat === you, won: lastRound.winners.includes(seat) }">
        <strong class="name">{{ seats[seat]?.name }}<span v-if="seat === you" class="mine"> {{ $t('common.youBracketed') }}</span></strong>
        <span class="rack">
          <Tile v-for="id in rack" :key="id" :settings="settings" :id="id" size="sm" :interactive="false" />
          <span v-if="!rack.length" class="muted">{{ t('summary.noTilesLeft') }}</span>
        </span>
        <span class="total muted">{{ t('summary.pointsOfTiles', { n: lastRound.totals[seat] }) }}</span>
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
li.me .name .mine {
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
