<script setup>
// The game itself: the scores, this round's trump and nominations, the table with the trick in the middle, and your hand.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { sortHand, SUIT_NAMES, SUIT_SYMBOLS } from '../../../shared/cards.js';
import Final from './Final.vue';
import RoundResult from './RoundResult.vue';
import TrickTable from './TrickTable.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const narrow = ref(false);
let query = null;
const onQuery = () => (narrow.value = query.matches);
onMounted(() => {
  query = window.matchMedia('(max-width: 719px)');
  onQuery();
  query.addEventListener('change', onQuery);
});
onBeforeUnmount(() => query?.removeEventListener('change', onQuery));

const hint = ref('');
watch(
  () => [props.state.phase, props.state.turn, props.state.round?.number],
  () => (hint.value = ''),
);

const you = computed(() => props.state.you);
const finished = computed(() => props.state.phase === 'finished');
const seats = computed(() => props.state.seats);
const round = computed(() => props.state.round);
const hand = computed(() => sortHand(props.state.hand));
const nameOf = (seat) => seats.value[seat]?.name ?? '';
const myTurn = computed(() => props.state.turn === you.value);
const total = computed(() => seats.value.reduce((sum, s) => sum + (s.bid ?? 0), 0));
const everyoneNominated = computed(() => seats.value.every((s) => s.bid !== null));
const lastRound = computed(() => props.state.rounds.at(-1) ?? null);

/** Everyone clockwise from the viewer, as TrickTable wants them. */
const ordered = computed(() => seats.value.map((_, i) => seats.value[(you.value + i) % seats.value.length]).map((s) => ({ key: s.seat, name: s.name, ...s })));

const board = computed(() => ({
  players: seats.value.map((s) => ({ id: s.seat, name: s.name, score: s.score, isMe: s.seat === you.value, away: s.away && !s.bot })),
  rounds: props.state.rounds,
}));

const trumpClass = computed(() => (round.value.trump === 'H' || round.value.trump === 'D' ? 'red' : ''));
const trumpText = computed(() => (round.value.trump ? SUIT_NAMES[round.value.trump] : 'no trumps'));

const options = computed(() => Array.from({ length: round.value.cards + 1 }, (_, n) => n));
const imDealer = computed(() => round.value.dealer === you.value);

const plays = computed(() => {
  const trick = props.state.trick.length ? props.state.trick : props.state.phase === 'roundEnd' ? (props.state.lastTrick?.plays ?? []) : [];
  return trick.map((p) => ({ key: p.seat, card: p.card }));
});
const winnerKey = computed(() => (props.state.trick.length ? props.state.trickWinner : props.state.phase === 'roundEnd' ? (props.state.lastTrick?.winner ?? null) : null));

const status = computed(() => {
  const { phase } = props.state;
  if (phase === 'nominating') return myTurn.value ? 'Your turn: nominate how many tricks you will win.' : `Waiting for ${nameOf(props.state.turn)} to nominate.`;
  if (phase === 'playing') {
    if (props.state.turn === null) return `${nameOf(props.state.trickWinner)} wins the trick.`;
    return myTurn.value ? 'Your turn: play a card.' : `Waiting for ${nameOf(props.state.turn)} to play.`;
  }
  if (phase === 'roundEnd') return 'The round is over.';
  return '';
});

function pick(card) {
  const reason = props.state.legal?.[card];
  if (reason) {
    hint.value = reason;
    return;
  }
  hint.value = '';
  props.send('play', { card });
}
</script>

<template>
  <div class="stack">
    <ScoreBoard :players="board.players" :rounds="board.rounds" :finished="finished" :low-is-better="false">
      <template #round>
        <RoundResult v-if="lastRound" :round="lastRound" :seats="seats" :you="you" />
      </template>
    </ScoreBoard>

    <section class="banner panel" aria-label="This round">
      <div class="info">
        <strong class="round-no">Round {{ round.number }} of {{ round.total }}</strong>
        <span class="muted">{{ round.cards }} {{ round.cards === 1 ? 'card' : 'cards' }} each</span>
        <span class="muted">Dealer: {{ nameOf(round.dealer) }}{{ imDealer ? ' (you)' : '' }}</span>
      </div>
      <div class="trump" :class="trumpClass" :title="`Trumps this round: ${trumpText}`">
        <span class="label">Trumps</span>
        <span class="suit"><span v-if="round.trump" aria-hidden="true">{{ SUIT_SYMBOLS[round.trump] }}</span> {{ trumpText }}</span>
      </div>
    </section>

    <Final v-if="finished" :state="state" :send="send" />

    <TrickTable :seats="ordered" :plays="plays" :turn-key="state.turn" :winner-key="winnerKey" :caption="state.phase === 'nominating' ? 'Nominations first' : state.phase === 'playing' ? 'Waiting for the lead' : ''">
      <template #seat="{ seat }">
        <div class="seat">
          <div class="seat-head">
            <span class="name">{{ seat.name }}</span>
            <span v-if="seat.seat === round.dealer" class="tag" title="Dealer">D</span>
          </div>
          <div class="seat-body">
            <span class="back-count" :title="`${seat.cards} cards`">
              <span class="card-back mini" aria-hidden="true" />
              <span class="n">{{ seat.cards }}</span>
            </span>
            <span class="tally">
              <template v-if="seat.bid !== null">bid <b>{{ seat.bid }}</b><template v-if="state.phase !== 'nominating'"> · won <b>{{ seat.tricks }}</b></template></template>
              <template v-else-if="state.phase === 'nominating' && state.turn === seat.seat" >choosing…</template>
              <template v-else>–</template>
            </span>
          </div>
          <span v-if="seat.away && !seat.bot" class="muted away">away</span>
        </div>
      </template>
      <template #me>
        <div class="seat mine">
          <div class="seat-head">
            <span class="name">{{ nameOf(you) }} (you)</span>
            <span v-if="imDealer" class="tag" title="Dealer">D</span>
            <span class="tally">
              <template v-if="seats[you].bid !== null">bid <b>{{ seats[you].bid }}</b><template v-if="state.phase !== 'nominating'"> · won <b>{{ seats[you].tricks }}</b></template></template>
              <template v-else>not yet nominated</template>
            </span>
          </div>
        </div>
      </template>
    </TrickTable>

    <p v-if="status" class="status" role="status">{{ status }}</p>

    <section v-if="state.phase === 'nominating' && myTurn" class="panel stack nominate" aria-label="Your nomination">
      <h3>How many tricks will you win?</h3>
      <div class="numbers">
        <button
          v-for="n in options"
          :key="n"
          class="number"
          :class="{ forbidden: n === state.forbidden }"
          :disabled="n === state.forbidden"
          :title="n === state.forbidden ? 'You cannot nominate this as the dealer' : ''"
          @click="send('nominate', { number: n })"
        >{{ n }}</button>
      </div>
      <p v-if="imDealer && state.forbidden !== null" class="rule">
        You are the dealer, so you cannot nominate <strong>{{ state.forbidden }}</strong>: the nominations would total {{ round.cards }}, the number of tricks, and somebody has to miss.
      </p>
      <p v-else-if="imDealer" class="rule">You are the dealer. The others have already nominated at least {{ round.cards }} tricks between them, so any number is allowed.</p>
      <p v-else class="muted">So far {{ total }} {{ total === 1 ? 'trick is' : 'tricks are' }} nominated out of {{ round.cards }}.</p>
    </section>
    <p v-else-if="state.phase === 'nominating' && !everyoneNominated && round.dealer === state.turn" class="muted rule">
      {{ nameOf(round.dealer) }} deals and nominates last: they cannot nominate {{ state.forbidden }}.
    </p>

    <section v-if="state.phase === 'roundEnd'" class="panel stack">
      <RoundResult v-if="lastRound" :round="lastRound" :seats="seats" :you="you" />
      <div class="row">
        <button class="primary" @click="send('next')">Deal round {{ round.number + 1 }}</button>
        <span class="muted">Anyone can deal the next round.</span>
      </div>
    </section>

    <section v-if="state.phase === 'nominating' || state.phase === 'playing'" class="hand-area" aria-label="Your hand">
      <div class="hand" :class="{ crowded: hand.length > 5 }">
        <PlayingCard
          v-for="card in hand"
          :key="card"
          :card="card"
          :size="narrow ? 'sm' : 'md'"
          :clickable="state.phase === 'playing' && myTurn"
          :dimmed="Boolean(state.legal?.[card])"
          :title="state.legal?.[card] ?? undefined"
          @pick="pick"
        />
        <p v-if="!hand.length" class="muted">You have no cards left.</p>
      </div>
      <p v-if="hint" class="hint" role="alert">{{ hint }}</p>
      <p v-else-if="state.phase === 'playing' && myTurn && hand.some((c) => state.legal?.[c])" class="muted">Dimmed cards cannot be played: you must follow suit.</p>
    </section>

    <div class="row"><button class="quiet" @click="send('leave')">Leave game</button><span v-if="!finished" class="muted">A computer player takes your seat if you leave.</span></div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0.9rem;
}
.info {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.9rem;
}
.round-no {
  font-family: var(--display);
  font-size: 1.15rem;
}
.trump {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.9rem;
  border-radius: 999px;
  border: 2px solid var(--amber);
  background: var(--bg-sunken);
}
.trump .label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.trump .suit {
  font-family: var(--display);
  font-size: 1.35rem;
  text-transform: capitalize;
}
.trump.red .suit {
  color: #ef6a5b;
}
.seat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}
.seat-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.5rem;
}
.seat .name {
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seat-body {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.back-count {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.mini {
  display: inline-block;
  width: 1.3rem;
  aspect-ratio: 5 / 7;
  border-width: 2px;
  border-radius: 4px;
}
.n {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.tally {
  white-space: nowrap;
  font-size: 0.85rem;
  color: var(--muted);
}
.tally b {
  color: var(--parchment);
}
.tag {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0 0.4rem;
  border-radius: 99px;
  background: var(--amber);
  color: var(--amber-ink);
}
.away {
  font-size: 0.75rem;
}
.mine {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
}
.status {
  margin: 0;
  text-align: center;
  font-family: var(--display);
  font-size: 1.1rem;
  color: var(--amber);
}
.nominate h3 {
  color: var(--amber);
}
.numbers {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.number {
  min-width: 3rem;
  padding: 0.6rem 0.9rem;
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.number.forbidden {
  text-decoration: line-through;
  border-style: dashed;
}
.rule {
  margin: 0;
  font-size: 0.92rem;
}
.hand-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
}
.hand {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
  padding-top: 0.8rem;
}
.hand.crowded {
  gap: 0.25rem;
}
.hint {
  margin: 0;
  color: var(--danger);
}
.hand-area .muted {
  margin: 0;
  font-size: 0.85rem;
}
@media (max-width: 719px) {
  .hand.crowded {
    gap: 0.15rem;
  }
}
</style>
