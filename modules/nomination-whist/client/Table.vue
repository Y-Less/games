<script setup>
// The game itself, in the standard frame: the score bar on top; the table (the trick in the middle, the nomination buttons in a zone of their own, and your hand along the bottom); and the two
// boxes along the bottom, Recent moves and Status. Everything that is said (whose turn it is, the round, the trumps,
// what you may not nominate), and the other players' details open from their chips in the score bar is in Status, so nothing in the play area grows, shrinks or moves while the game is played.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import OpponentHands from '../../../src/components/OpponentHands.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import TrickCircle from '../../../src/components/TrickCircle.vue';
import { sortHand, SUIT_NAMES, SUIT_SYMBOLS } from '../../../shared/cards.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import Final from './Final.vue';
import { movesBetween } from './log.js';
import RoundResult from './RoundResult.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const hint = ref('');
watch(
  () => [props.state.phase, props.state.turn, props.state.round?.number],
  () => (hint.value = ''),
);

// ---- Recent moves, worked out from what changes ----
const moves = ref(movesBetween(null, props.state));
watch(
  () => props.state,
  (next, prev) => {
    moves.value = [...moves.value, ...movesBetween(prev, next)].slice(-60);
  },
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
const waitingFor = computed(() => (props.state.phase === 'roundEnd' ? seats.value.filter((s) => !s.ready).map((s) => s.name) : []));
const lastRound = computed(() => props.state.rounds.at(-1) ?? null);
const instantWinner = computed(() => (props.state.instantWin === null || props.state.instantWin === undefined ? null : (seats.value[props.state.instantWin] ?? null)));
const nominating = computed(() => props.state.phase === 'nominating' && myTurn.value);

/** Everyone clockwise from the viewer, as TrickCircle wants them. */
const ordered = computed(() => seats.value.map((_, i) => seats.value[(you.value + i) % seats.value.length]).map((s) => ({ key: s.seat, name: s.name, ...s })));
const others = computed(() => ordered.value.slice(1));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The short line under an opponent's name: what they nominated and how many tricks they have won so far. */
function noteFor(seat) {
  if (seat.bid === null) {
    if (props.state.phase === 'nominating' && props.state.turn === seat.seat) return 'nominating…';
    return seat.seat === props.state.round?.dealer ? 'dealer' : 'not yet nominated'; // the dealer nominates last
  }
  return props.state.phase === 'nominating' ? `nominated ${seat.bid}` : `nominated ${seat.bid} · won ${seat.tricks}`;
}
const opponents = computed(() => others.value.map((s) => ({ key: s.seat, name: s.name, cards: s.cards, note: noteFor(s), away: Boolean(s.away && !s.bot), current: s.seat === props.state.turn })));

// Another player's details (cards in hand, nomination, dealer) open from their chip in the score bar: one at a time,
// floating over the top of the main area so that nothing moves.
const board = computed(() => ({
  players: seats.value.map((s) => ({ id: s.seat, name: s.name, score: s.score, isMe: s.seat === you.value, bot: Boolean(s.bot), current: s.seat === props.state.turn, away: s.away && !s.bot, ready: s.ready, note: s.seat === props.state.instantWin ? 'instant win' : undefined })),
  rounds: props.state.rounds,
}));
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => board.value.players,
  hostId: () => props.state.hostSeat,
  isHost: () => props.state.hostSeat === you.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
const opened = computed(() => ordered.value.find((o) => o.seat === openId.value) ?? null); // yours too: your own summary

const trumpClass = computed(() => (round.value.trump === 'H' || round.value.trump === 'D' ? 'red' : ''));
const trumpText = computed(() => (round.value.trump ? SUIT_NAMES[round.value.trump] : 'no trumps'));
const imDealer = computed(() => round.value.dealer === you.value);
const MOST_CARDS = 7; // the most cards in a hand: the nomination zone always has room for 0 to this
const options = computed(() => Array.from({ length: Math.min(MOST_CARDS, round.value.cards) + 1 }, (_, n) => n));

const plays = computed(() => {
  const trick = props.state.trick.length ? props.state.trick : props.state.phase === 'roundEnd' ? (props.state.lastTrick?.plays ?? []) : [];
  return trick.map((p) => ({ key: p.seat, card: p.card }));
});
const winnerKey = computed(() => (props.state.trick.length ? props.state.trickWinner : props.state.phase === 'roundEnd' ? (props.state.lastTrick?.winner ?? null) : null));

const headline = computed(() => {
  const { phase } = props.state;
  if (phase === 'nominating') return myTurn.value ? 'Your turn: nominate how many tricks you will win.' : `Waiting for ${nameOf(props.state.turn)} to nominate.`;
  if (phase === 'playing') {
    if (props.state.turn === null) return `${nameOf(props.state.trickWinner)} wins the trick.`;
    return myTurn.value ? 'Your turn: play a card.' : `Waiting for ${nameOf(props.state.turn)} to play.`;
  }
  if (phase === 'roundEnd') return seats.value[you.value].ready ? `Waiting for ${waitingFor.value.join(', ')} to be ready for the next round.` : 'The round is over: close the scores to carry on.';
  if (finished.value) return instantWinner.value ? `${instantWinner.value.name} wins the game instantly!` : 'The game is over.';
  return '';
});
const mineNow = computed(
  () =>
    !finished.value &&
    ((props.state.phase === 'nominating' && myTurn.value) ||
      (props.state.phase === 'playing' && myTurn.value && props.state.turn !== null) ||
      (props.state.phase === 'roundEnd' && !seats.value[you.value].ready)),
);
const statusLines = computed(() => {
  const lines = [];
  if (hint.value) lines.push({ text: hint.value, tone: 'warn' });
  if (props.state.phase === 'nominating') {
    if (myTurn.value && imDealer.value && props.state.forbidden !== null) {
      lines.push(`You are the dealer, so you cannot nominate ${props.state.forbidden}: the nominations would total ${round.value.cards}, the number of tricks, and somebody has to miss.`);
    } else if (myTurn.value && imDealer.value) {
      lines.push(`You are the dealer. The others have already nominated at least ${round.value.cards} tricks between them, so any number is allowed.`);
    } else if (!everyoneNominated.value && round.value.dealer === props.state.turn) {
      lines.push({ text: `${nameOf(round.value.dealer)} deals and nominates last: they cannot nominate ${props.state.forbidden}.`, tone: 'muted' });
    }
  }
  if (props.state.phase === 'playing' && myTurn.value && hand.value.some((c) => props.state.legal?.[c])) lines.push({ text: 'Dimmed cards cannot be played: you must follow suit.', tone: 'muted' });
  if (finished.value && instantWinner.value) lines.push({ text: `They nominated 7 and won all 7 tricks in ${lastRound.value?.label}.`, tone: 'muted' });
  return lines;
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

// The sizes follow the room the frame leaves, never the game, so nothing changes size while playing.
const TOP_RESERVE = 124; // pixels kept clear along the top for an opponent's hand
const TOP_HANDS = [1, 3, 5, 6]; // how many opponents there are when one sits along the top, over the trick
const roomFor = (area) => {
  const handLarge = area.height >= 600;
  const handRem = handLarge ? 9.2 : 7.2;
  const spare = area.height - (0.4 + handRem) * 16 - 8 - (TOP_HANDS.includes(others.value.length) ? TOP_RESERVE : 0); // the hand and the gap above it
  // The trick is drawn large and then scaled to the room that is left (never to what is on the table).
  return { hand: handLarge ? 'lg' : 'md', zoom: Math.max(0.8, Math.min(1.6, spare / 242)) };
};
</script>

<template>
  <GameFrame class="whist-table" :main-span="8">
    <template #scorebar>
      <ScoreBoard :players="board.players" :rounds="board.rounds" :finished="finished && !instantWinner" :low-is-better="false" :awaiting="state.phase === 'roundEnd' && !seats[you].ready" :waiting="waitingFor" :sticky="false" v-bind="scoreProps" @continue="send('next')">
        <template #round>
          <p v-if="instantWinner" class="instant-note" role="status"><strong>{{ instantWinner.name }}{{ instantWinner.seat === you ? ' (you)' : '' }} wins the game instantly!</strong> They nominated 7 and won all 7 tricks in {{ lastRound?.label }}.</p>
          <RoundResult v-if="lastRound" :round="lastRound" :seats="seats" :you="you" />
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <div class="arena">
        <PlayerPopup v-if="popupProps" v-bind="popupProps">
          <dl v-if="opened" class="facts">
            <dt>Dealer</dt>
            <dd>{{ opened.seat === round.dealer ? 'yes' : 'no' }}</dd>
            <dt>Cards in hand</dt>
            <dd>{{ opened.cards }}</dd>
            <dt>Nomination</dt>
            <dd>
              <template v-if="opened.bid !== null">nominated <b>{{ opened.bid }}</b><template v-if="state.phase !== 'nominating'"> · won <b>{{ opened.tricks }}</b></template></template>
              <template v-else-if="state.phase === 'nominating' && state.turn === opened.seat">choosing…</template>
              <template v-else>not yet</template>
            </dd>
            <dt>Score</dt>
            <dd>{{ opened.score }}</dd>
          </dl>
        </PlayerPopup>

        <Final v-if="finished" class="zone-wide" :state="state" :send="send" />
        <template v-else>
          <div class="opponents"><OpponentHands :opponents="opponents" :max="MOST_CARDS" /></div>
          <div class="centre" :style="{ paddingTop: TOP_HANDS.includes(others.length) ? `${TOP_RESERVE}px` : undefined }" aria-live="polite">
            <TrickCircle :style="{ zoom: roomFor(area).zoom }" :seats="ordered" :plays="plays" :winner-key="winnerKey" size="lg" labels />
          </div>
          <section class="nominate" :class="{ live: nominating, hidden: state.phase !== 'nominating' }" aria-label="Your nomination">
            <h3>Your nomination</h3>
            <div class="numbers">
              <button
                v-for="n in options"
                :key="n"
                class="number"
                :class="{ forbidden: n === state.forbidden && nominating }"
                :disabled="!nominating || n === state.forbidden"
                :title="n === state.forbidden && nominating ? 'You cannot nominate this as the dealer' : ''"
                @click="send('nominate', { number: n })"
              >{{ n }}</button>
            </div>
          </section>
        </template>

        <div class="mine">
          <section class="hand" :class="roomFor(area).hand" aria-label="Your hand">
            <PlayingCard
              v-for="card in hand"
              :key="card"
              :card="card"
              :size="roomFor(area).hand"
              :clickable="state.phase === 'playing' && myTurn"
              :dimmed="Boolean(state.legal?.[card])"
              :title="state.legal?.[card] ?? undefined"
              @pick="pick"
            />
          </section>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="moves" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry.text }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :lines="statusLines">
        <template #facts>
          <strong>Round {{ round.number }} of {{ round.total }}</strong>
          <span>{{ round.cards }} {{ round.cards === 1 ? 'card' : 'cards' }} each</span>
          <span>Dealer: {{ nameOf(round.dealer) }}{{ imDealer ? ' (you)' : '' }}</span>
          <span class="tally">
            <template v-if="seats[you].bid !== null">You nominated <b>{{ seats[you].bid }}</b><template v-if="state.phase !== 'nominating'"> · won <b>{{ seats[you].tricks }}</b></template></template>
            <template v-else>You have not nominated yet</template>
          </span>
          <span class="trump" :class="trumpClass" :title="`Trumps this round: ${trumpText}`">Trumps: <b><span v-if="round.trump" aria-hidden="true">{{ SUIT_SYMBOLS[round.trump] }}</span> {{ trumpText }}</b></span>
          <span v-if="state.phase === 'nominating'">{{ total }} of {{ round.cards }} {{ round.cards === 1 ? 'trick' : 'tricks' }} nominated</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
/* This game has no slim bars below the table, so the frame has three rows: score bar, table, bottom boxes. */
.game-frame.whist-table {
  grid-template-rows: auto minmax(0, 1fr) clamp(6.5rem, 22%, 13rem);
}
.instant-note {
  color: var(--amber);
  margin-bottom: 0.6rem;
}
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  grid-template-rows: minmax(0, 1fr) auto;
  row-gap: 8px;
  min-height: 0;
}
.head,
.body {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.name {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tally b {
  color: var(--parchment);
}
.tag {
  flex: none;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0 0.4rem;
  border-radius: 99px;
  background: var(--amber);
  color: var(--amber-ink);
}
.tag.quiet-tag {
  background: none;
  border: 1px solid var(--line);
  color: var(--muted);
  font-weight: 400;
}
.trump.red b {
  color: #ef6a5b;
}
.trump b {
  text-transform: capitalize;
}

/* Another player's details, in the panel of the standard player pop-up (opened from their chip in the score bar). */
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 1rem;
  margin: 0;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.facts dd b {
  color: var(--parchment);
}

/* The opponents' hands go round the edges of the table above your own hand. */
.opponents {
  grid-column: 1 / -1;
  grid-row: 1 / -1;
  position: relative;
  min-width: 0;
  min-height: 0;
}

/* The trick in the middle of the left part, the nomination zone in the right part (the same size whatever it holds). */
.centre {
  grid-column: 1 / -1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* The nomination buttons sit over the middle of the whole table, which is where the cards are played later. */
.nominate {
  grid-column: 1 / -1;
  grid-row: 1;
  z-index: 2;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  pointer-events: none;
}
.nominate .numbers {
  pointer-events: auto;
}
.nominate.hidden {
  visibility: hidden; /* once the round has started the zone stays (so nothing moves) but is empty */
}
.nominate h3 {
  margin: 0;
  text-align: center;
  font-size: 0.95rem;
  color: var(--muted);
}
.nominate.live h3 {
  color: var(--amber);
}
.numbers {
  display: flex;
  flex-wrap: wrap;
  justify-content: center; /* a short row (a round of one or two cards) is centred, not pushed to the left */
  gap: 0.5rem;
  width: calc(4 * 5.6rem + 3 * 0.5rem); /* at most four to a row */
}
.number {
  width: 5.6rem;
  height: 2.8rem;
  padding: 0;
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.number.forbidden {
  text-decoration: line-through;
  border-style: dashed;
}
.zone-wide {
  grid-column: 1 / -1;
  min-height: 0;
  overflow-y: auto;
}

/* Your hand along the bottom: the room for a full hand is always there, so playing a card moves nothing. */
.mine {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.hand {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 0.4rem;
  height: 7.2rem; /* medium cards (6.2rem) and the lift of the one under the pointer */
}
.hand.lg {
  height: 9.2rem;
}
</style>
