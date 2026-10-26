<script setup>
// One player's board: prestige, tokens, card bonuses, nobles and reserved cards.
// Your own reserved cards are shown and can be picked; other players' are shown face down (or face up if they were
// reserved from the table).
import { computed } from 'vue';
import { CARD_BY_ID, NOBLE_BY_ID } from '../cards.js';
import CardFace from './CardFace.vue';
import Gem from './Gem.vue';
import { GEM_NAMES } from './gems.js';

const props = defineProps({
  seat: { type: Object, required: true },
  isMe: { type: Boolean, default: false },
  isTurn: { type: Boolean, default: false },
  afford: { type: Object, default: () => ({}) },
  selected: { type: String, default: null },
  interactive: { type: Boolean, default: false },
  large: { type: Boolean, default: false }, // your own board: full-size reserved cards and bigger gems
  gem: { type: Number, default: 19 }, // the size of a gem in px
  pickTokens: { type: Boolean, default: false }, // your own board while returning tokens: the tokens are the selector
  give: { type: Array, default: () => [0, 0, 0, 0, 0, 0] }, // how many of each token are marked to give back
});
defineEmits(['pick', 'token']);

const total = computed(() => props.seat.tokens.reduce((a, b) => a + b, 0));
const needOf = (id) => CARD_BY_ID[id].cost.map((c, i) => Math.max(0, c - props.seat.bonuses[i]));
</script>

<template>
  <section class="board panel" :class="{ me: isMe, turn: isTurn, large }" :style="{ '--gem': `${gem}px` }" :aria-label="`${seat.name}'s board`">
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
          <template v-for="(n, c) in seat.tokens" :key="c">
            <button
              v-if="pickTokens"
              class="held token-btn"
              :class="{ picked: give[c] > 0 }"
              :disabled="n === 0"
              :aria-pressed="give[c] > 0"
              :aria-label="`Give back ${GEM_NAMES[c]}: you hold ${n}, ${give[c]} marked`"
              @click="$emit('token', c)"
            >
              <Gem :colour="c" :size="gem" :count="n" :faded="n === 0" />
              <span v-if="give[c] > 0" class="badge">{{ give[c] }}</span>
            </button>
            <span v-else class="held"><Gem :colour="c" :size="gem" :count="n" :faded="n === 0" /></span>
          </template>
        </span>
      </div>
      <div class="row-block" :title="`Card bonuses (${seat.bought} ${seat.bought === 1 ? 'card' : 'cards'})`">
        <span class="label">Cards <small>{{ seat.bought }}</small></span>
        <span class="gems">
          <span v-for="(n, c) in seat.bonuses" :key="c" class="held"><Gem :colour="c" :size="gem" :count="n" :faded="n === 0" /></span>
          <span v-for="n in seat.nobles" :key="n" class="noble-badge" :title="NOBLE_BY_ID[n].name" :aria-label="`Noble: ${NOBLE_BY_ID[n].name}`">&#9819;3</span>
        </span>
      </div>
    </div>
    <div class="reserved" :aria-label="`Reserved cards (${seat.reserved.length}/3)`" :title="`Reserved (${seat.reserved.length}/3)`">
      <template v-for="(r, i) in seat.reserved" :key="r.card ?? `hidden-${i}`">
        <CardFace
          v-if="r.card"
          :small="!large"
          :card="r.card"
          :need="needOf(r.card)"
          :affordable="Boolean(afford[r.card])"
          :selected="selected === r.card"
          :clickable="isMe && interactive"
          @pick="$emit('pick', r.card)"
        />
        <CardFace v-else :small="!large" :level="r.level" />
      </template>
      <span v-for="i in 3 - seat.reserved.length" :key="`free-${i}`" class="free-slot" aria-hidden="true" />
    </div>
    <div v-if="large" class="actions"><slot name="actions" /></div>
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
  gap: 0.45em;
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
  gap: 0.3em;
}
.label {
  font-size: 0.55em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  line-height: 1.5;
}
.label small {
  font-size: 1em;
}
.gems {
  display: flex;
  gap: 0.15em;
  align-items: center;
  height: calc(var(--gem, 19px) + 2px);
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
.board.large {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  row-gap: 0.5em;
  padding: 0.5em 0.6em 0.6em;
}
.board.large .reserved {
  justify-content: space-between;
}
/* the bottom row of your own board: the buttons for what you are doing. Its height is always reserved. */
.actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.6rem;
  flex-wrap: nowrap;
  overflow: hidden;
}
.actions :deep(button) {
  padding: 0.25rem 0.9rem;
  font-size: 0.9rem;
  white-space: nowrap;
}
.token-btn {
  position: relative;
  padding: 0;
  margin: 0;
  border: 0;
  background: none;
  border-radius: 999px;
  cursor: pointer;
}
.token-btn:disabled {
  cursor: default;
}
.token-btn.picked {
  box-shadow: 0 0 0 3px var(--amber);
}
.token-btn.picked :deep(.gem) {
  opacity: 0.55;
}
.badge {
  position: absolute;
  top: -0.4em;
  right: -0.3em;
  min-width: 1.3em;
  height: 1.3em;
  border-radius: 999px;
  background: var(--amber);
  color: var(--amber-ink);
  font-size: 0.75em;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.board.large .name {
  font-size: 1.1em;
  max-width: 10em;
}
.board.large .left {
  gap: 0.7em;
}
.board.large .label {
  font-size: 0.65em;
}
.board.large .free-slot {
  width: 5.8em;
  height: 7.8em;
  border-radius: 0.6em;
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
