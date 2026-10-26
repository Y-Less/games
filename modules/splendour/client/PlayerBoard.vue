<script setup>
// One player's board: prestige, tokens, card bonuses, nobles and reserved cards.
// Your own reserved cards are shown and can be picked; other players' are shown face down (or face up if they were
// reserved from the table).
import { computed } from 'vue';
import { CARD_BY_ID, NOBLE_BY_ID } from '../cards.js';
import CardFace from './CardFace.vue';
import Gem from './Gem.vue';

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
    <div class="left">
      <header class="head">
        <strong class="name" :title="seat.name">{{ seat.name }}</strong>
        <span v-if="isMe" class="tag mine">you</span>
        <span v-else-if="seat.bot" class="tag" :title="seat.ai ? `Computer player: ${seat.ai.name}` : 'Computer player'">cpu</span>
        <span v-else-if="!seat.online" class="tag away">away</span>
        <span class="prestige" :title="`${seat.prestige} prestige`"><b>{{ seat.prestige }}</b><small>pts</small></span>
      </header>
      <div class="row-block" :title="`Tokens (${total}/10)`">
        <span class="label">Tokens <small>{{ total }}/10</small></span>
        <span class="gems">
          <span v-for="(n, c) in seat.tokens" :key="c" class="held"><Gem :colour="c" :size="19" :count="n" :faded="n === 0" /></span>
        </span>
      </div>
      <div class="row-block" :title="`Card bonuses (${seat.bought} ${seat.bought === 1 ? 'card' : 'cards'})`">
        <span class="label">Cards <small>{{ seat.bought }}</small></span>
        <span class="gems">
          <span v-for="(n, c) in seat.bonuses" :key="c" class="held"><Gem :colour="c" :size="19" :count="n" :faded="n === 0" /></span>
          <span v-for="n in seat.nobles" :key="n" class="noble-badge" :title="NOBLE_BY_ID[n].name" :aria-label="`Noble: ${NOBLE_BY_ID[n].name}`">&#9819;3</span>
        </span>
      </div>
    </div>
    <div class="reserved" :aria-label="`Reserved cards (${seat.reserved.length}/3)`" :title="`Reserved (${seat.reserved.length}/3)`">
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
      <span v-for="i in 3 - seat.reserved.length" :key="`free-${i}`" class="free-slot" aria-hidden="true" />
    </div>
  </section>
</template>

<style scoped>
/* A compact board: names, tokens and card bonuses on the left, the three reserve slots on the right. Sizes are in em
   so the table scales with the window; the height never depends on what the player holds. */
.board {
  display: flex;
  justify-content: space-between;
  gap: 0.5em;
  padding: 0.4em 0.5em;
  border-radius: 0.7em;
  box-sizing: border-box;
  min-width: 0;
}
.board.me {
  border-color: var(--amber);
}
.board.turn {
  box-shadow: 0 0 0 2px var(--amber), 0 0 14px rgb(224 168 74 / 0.25);
}
.left {
  display: flex;
  flex-direction: column;
  gap: 0.25em;
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.3em;
  min-width: 0;
  height: 1.5em;
}
.name {
  min-width: 0;
  flex: 0 1 auto;
  max-width: 7em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85em;
}
.tag {
  font-size: 0.5em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 0.45em;
  border-radius: 999px;
  border: 1px solid var(--muted);
  color: var(--muted);
  white-space: nowrap;
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
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 0.15em;
}
.prestige b {
  font-family: var(--display);
  font-size: 1.3em;
  color: var(--amber);
  line-height: 1;
}
.prestige small {
  color: var(--muted);
  font-size: 0.5em;
}
.row-block {
  display: flex;
  flex-direction: column;
  gap: 0.05em;
}
.label {
  font-size: 0.55em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  line-height: 1.1;
}
.label small {
  font-size: 1em;
}
.gems {
  display: flex;
  gap: 0.15em;
  align-items: center;
  height: 1.3em;
}
.held {
  display: inline-flex;
}
.noble-badge {
  font-size: 0.65em;
  padding: 0 0.35em;
  border-radius: 999px;
  border: 1px solid #8a6a2c;
  color: var(--amber);
  background: #251d10;
  white-space: nowrap;
}
.reserved {
  display: flex;
  gap: 0.25em;
  align-items: flex-start;
  flex: none;
}
.free-slot {
  width: 3.4em;
  height: 4.6em;
  border-radius: 0.45em;
  border: 1px dashed var(--line);
  box-sizing: border-box;
}
</style>
