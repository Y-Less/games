<script setup>
// One player's board: prestige, tokens, card bonuses, nobles and reserved cards.
// Your own reserved cards are shown and can be picked; other players' are shown face down (or face up if they were
// reserved from the table).
import { computed } from 'vue';
import { CARD_BY_ID } from '../cards.js';
import CardFace from './CardFace.vue';
import Gem from './Gem.vue';
import NobleTile from './NobleTile.vue';

const props = defineProps({
  seat: { type: Object, required: true },
  isMe: { type: Boolean, default: false },
  isTurn: { type: Boolean, default: false },
  afford: { type: Object, default: () => ({}) },
  selected: { type: String, default: null },
  interactive: { type: Boolean, default: false },
});
defineEmits(['pick']);

const total = computed(() => props.seat.tokens.reduce((a, b) => a + b, 0));
const needOf = (id) => CARD_BY_ID[id].cost.map((c, i) => Math.max(0, c - props.seat.bonuses[i]));
</script>

<template>
  <section class="board panel" :class="{ me: isMe, turn: isTurn }" :aria-label="`${seat.name}'s board`">
    <header class="head">
      <span class="who">
        <strong class="name">{{ seat.name }}</strong>
        <span v-if="isMe" class="tag mine">you</span>
        <span v-if="seat.bot" class="tag">computer</span>
        <span v-else-if="!seat.online" class="tag away">away</span>
        <span v-if="isTurn" class="tag turn-tag">{{ isMe ? 'your turn' : 'their turn' }}</span>
      </span>
      <span class="prestige" :title="`${seat.prestige} prestige`"><b>{{ seat.prestige }}</b><small>prestige</small></span>
    </header>

    <div class="row-block">
      <span class="label">Tokens <small class="muted">({{ total }}/10)</small></span>
      <span class="gems">
        <span v-for="(n, c) in seat.tokens" :key="c" class="held" :class="{ none: n === 0 }"><Gem :colour="c" :size="26" :count="n" :faded="n === 0" /></span>
      </span>
    </div>
    <div class="row-block">
      <span class="label">Card bonuses <small class="muted">({{ seat.bought }} {{ seat.bought === 1 ? 'card' : 'cards' }})</small></span>
      <span class="gems">
        <span v-for="(n, c) in seat.bonuses" :key="c" class="held bonus" :class="{ none: n === 0 }">
          <Gem :colour="c" :size="26" :faded="n === 0" /><b>{{ n }}</b>
        </span>
      </span>
    </div>
    <div v-if="seat.nobles.length" class="row-block">
      <span class="label">Nobles</span>
      <span class="gems"><NobleTile v-for="n in seat.nobles" :key="n" :noble="n" small /></span>
    </div>
    <div class="row-block">
      <span class="label">Reserved <small class="muted">({{ seat.reserved.length }}/3)</small></span>
      <span class="reserved">
        <template v-for="(r, i) in seat.reserved" :key="r.card ?? `hidden-${i}`">
          <CardFace
            v-if="r.card"
            small
            :card="r.card"
            :need="needOf(r.card)"
            :affordable="Boolean(afford[r.card])"
            :selected="selected === r.card"
            :clickable="isMe && interactive"
            @pick="$emit('pick', r.card)"
          />
          <CardFace v-else small :level="r.level" />
        </template>
        <span v-if="!seat.reserved.length" class="muted none-text">none</span>
      </span>
    </div>
  </section>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.7rem 0.85rem;
}
.board.me {
  border-color: var(--amber);
}
.board.turn {
  box-shadow: 0 0 0 2px var(--amber), 0 0 18px rgb(224 168 74 / 0.25);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.who {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  min-width: 0;
}
.name {
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--muted);
  color: var(--muted);
}
.tag.mine,
.tag.turn-tag {
  border-color: var(--amber);
  color: var(--amber);
}
.tag.away {
  border-color: var(--danger);
  color: var(--danger);
}
.prestige {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
}
.prestige b {
  font-family: var(--display);
  font-size: 1.7rem;
  color: var(--amber);
  line-height: 1;
}
.prestige small {
  color: var(--muted);
  font-size: 0.7rem;
}
.row-block {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.label {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.gems {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}
.held {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}
.held.bonus b {
  font-size: 0.95rem;
  min-width: 0.7rem;
}
.held.none b {
  color: var(--muted);
}
.reserved {
  display: flex;
  gap: 0.4rem;
  align-items: flex-start;
  flex-wrap: wrap;
  min-height: 1.5rem;
}
.none-text {
  font-size: 0.85rem;
}
</style>
