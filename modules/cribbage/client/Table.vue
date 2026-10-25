<script setup>
// The discard and play phases: opponents, crib, starter, the running count, your hand and the scoring log.
import { computed, ref, watch } from 'vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import CardRow from './CardRow.vue';
import { seatColour } from './colours.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const picked = ref([]);
const me = computed(() => props.state.you);
const seats = computed(() => props.state.seats);
const others = computed(() => seats.value.filter((s) => s.seat !== me.value));
const dealer = computed(() => seats.value[props.state.dealer]);
const youDeal = computed(() => props.state.dealer === me.value);
const inPlay = computed(() => props.state.phase === 'play');
const turn = computed(() => (inPlay.value ? props.state.play.turn : -1));
const myTurn = computed(() => turn.value === me.value);
const playable = computed(() => new Set(props.state.play?.playable ?? []));
const log = computed(() => [...props.state.log].reverse());
const need = computed(() => props.state.need);
const cribOwner = computed(() => (youDeal.value ? 'your' : `${dealer.value.name}'s`));
const waitingFor = computed(() => seats.value.filter((s) => !s.discarded).map((s) => s.name));

watch(
  () => props.state.hand.join(),
  () => (picked.value = picked.value.filter((c) => props.state.hand.includes(c))),
);
watch(
  () => props.state.phase,
  () => (picked.value = []),
);

function pick(card) {
  if (props.state.phase === 'discard') {
    if (!need.value) return;
    if (picked.value.includes(card)) picked.value = picked.value.filter((c) => c !== card);
    else if (picked.value.length < need.value) picked.value = [...picked.value, card];
    else picked.value = [...picked.value.slice(1), card];
  } else if (myTurn.value) {
    props.send('play', { card });
  }
}
async function discard() {
  const reply = await props.send('discard', { cards: picked.value });
  if (reply?.ok) picked.value = [];
}
</script>

<template>
  <div class="stack table">
    <div class="opponents">
      <div v-for="s in others" :key="s.seat" class="opp" :class="{ turn: s.seat === turn }">
        <div class="who">
          <span class="chip" :style="{ background: seatColour(s.seat) }" />
          <strong>{{ s.name }}</strong>
          <span v-if="s.seat === state.dealer" class="badge" title="Dealer">D</span>
          <span v-if="!s.online" class="muted">away</span>
          <span v-else-if="state.phase === 'discard'" class="muted">{{ s.discarded ? 'done' : 'choosing' }}</span>
        </div>
        <div class="fan" :aria-label="`${s.name} holds ${s.cards} cards`">
          <PlayingCard v-for="n in s.cards" :key="n" :card="null" size="sm" class="mini" />
          <span v-if="!s.cards" class="muted">no cards left</span>
        </div>
      </div>
    </div>

    <div class="middle">
      <div class="pile">
        <div class="slot-box"><PlayingCard :card="null" size="sm" /></div>
        <small class="muted">Deck ({{ state.deckCount }})</small>
      </div>
      <div class="pile">
        <div class="slot-box">
          <PlayingCard v-if="state.starter" :card="state.starter" size="sm" />
          <PlayingCard v-else :card="null" size="sm" class="faded" />
        </div>
        <small class="muted">Starter</small>
      </div>
      <div class="pile">
        <div class="crib">
          <PlayingCard v-for="n in Math.max(state.cribCount, 1)" :key="n" :card="null" size="sm" :class="{ faded: !state.cribCount }" />
        </div>
        <small class="muted">{{ youDeal ? 'Your' : `${dealer.name}'s` }} crib ({{ state.cribCount }})</small>
      </div>
    </div>

    <section v-if="inPlay || state.phase === 'discard'" class="panel zone">
      <template v-if="inPlay">
      <div class="count-line">
        <span class="muted">Count</span>
        <strong class="count">{{ state.play.count }}</strong>
        <span class="turn-note" :class="{ mine: myTurn }">
          {{ myTurn ? (playable.size ? 'Your turn: choose a card' : 'Your turn') : `${seats[turn].name} to play` }}
        </span>
      </div>
      <div class="seq">
        <CardRow v-if="state.play.sequence.length" :cards="state.play.sequence.map((x) => x.card)" />
        <CardRow v-else-if="state.play.previous.length" :cards="state.play.previous" dim />
        <div v-if="state.play.sequence.length" class="who-played">
          <span v-for="(x, i) in state.play.sequence" :key="i" class="dot" :style="{ background: seatColour(x.seat) }" :title="seats[x.seat].name" />
        </div>
        <p v-else class="muted small">{{ state.play.previous.length ? 'The count has started again at 0.' : 'Nothing played yet.' }}</p>
      </div>
      </template>

      <div v-else class="stack">
      <template v-if="need">
        <p>
          Choose <strong>{{ need }}</strong> card{{ need === 1 ? '' : 's' }} for {{ cribOwner }} crib
          <span class="muted">({{ picked.length }} of {{ need }} chosen)</span>
        </p>
        <div><button class="primary" :disabled="picked.length !== need" @click="discard">Send to the crib</button></div>
      </template>
      <p v-else class="muted">Waiting for {{ waitingFor.join(', ') }}…</p>
      </div>
    </section>

    <section class="hand-area">
      <div class="hand" aria-label="Your hand">
        <PlayingCard
          v-for="card in state.hand"
          :key="card"
          :card="card"
          clickable
          :selected="picked.includes(card)"
          :disabled="state.phase === 'discard' ? !need : !myTurn || !playable.has(card)"
          @pick="pick"
        />
        <span v-if="!state.hand.length" class="muted">Your cards are all played.</span>
      </div>
    </section>

    <section class="panel log">
      <h3>Scoring</h3>
      <ul>
        <li v-if="!log.length" class="muted">Nothing scored yet this hand.</li>
        <li v-for="(entry, i) in log" :key="log.length - i">
          <span class="dot" :style="{ background: seatColour(entry.seat) }" />
          {{ entry.text }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.opponents {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.opp {
  flex: 1 1 9rem;
  min-height: 6.2rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-sunken);
}
.opp.turn {
  border-color: var(--amber);
}
.who {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
  min-height: 1.5rem;
}
.chip,
.dot {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  flex: none;
  display: inline-block;
}
.badge {
  background: var(--amber);
  color: var(--amber-ink);
  border-radius: 50%;
  width: 1.3rem;
  height: 1.3rem;
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  font-weight: 700;
}
.fan {
  display: flex;
  min-height: 2.8rem;
  align-items: center;
}
.fan .mini {
  --w: 2rem;
  margin-right: -1rem;
}
.middle {
  display: flex;
  gap: 1.2rem;
  justify-content: center;
  flex-wrap: wrap;
}
.pile {
  width: 8rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.slot-box,
.crib {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 4.2rem; /* a small card: the pile areas never change size as the crib fills up */
}
small {
  white-space: nowrap;
}
.crib :deep(.playing-card:not(:first-child)) {
  margin-left: -2.4rem;
}
.faded {
  opacity: 0.25;
}
.zone {
  min-height: 11.5rem; /* the discard prompt and the pegging area share one box */
}
.count-line {
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.count {
  font-family: var(--display);
  font-size: 2.2rem;
  color: var(--amber);
  line-height: 1;
}
.turn-note {
  color: var(--muted);
}
.turn-note.mine {
  color: var(--amber);
  font-weight: 650;
}
.seq {
  margin-top: 0.6rem;
  min-height: 6.3rem;
}
.who-played {
  display: flex;
  gap: 0.2rem;
  margin-top: 0.3rem;
}
.small {
  margin: 0.3rem 0 0;
  font-size: 0.9rem;
}
.hand {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.3rem;
  padding-top: 0.8rem;
  box-sizing: content-box;
  min-height: 6.2rem; /* a full-size card, so the hand never shrinks as cards are played */
}
.hand :deep(.playing-card) {
  --w: clamp(2.6rem, 12vw, 4.4rem);
}
.hand :deep(.playing-card.face:hover) {
  background: #fbf8f0;
  border-color: #b9b2a2;
}
.log ul {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  height: 9rem;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.log li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
