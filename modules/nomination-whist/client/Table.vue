<script setup>
// Props: state {Object, required} the player's view of the game; send {Function, required} sends a request to the server.
// Emits: none (requests go through `send`: play, nominate, next, kick, removeBot).
// Slots: none (fills GameFrame's scorebar, main, log, and status slots).
// Side effects: watches the state to reset the hint; no timers or listeners of its own (the Recent moves list is kept by the page, see log.js).
// The game itself, in the standard frame: the score bar on top; the table (the trick in the middle, the nomination buttons in a zone of their own, and your hand along the bottom); and the two
// boxes along the bottom, Recent moves and Status.  Everything that is said (whose turn it is, the round, the trumps,
// what you may not nominate), and the other players' details open from their chips in the score bar is in Status, so nothing in the play area grows, shrinks, or moves while the game is played.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import OpponentHands from '../../../src/components/OpponentHands.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import CardFan from '../../../src/components/CardFan.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import TrickCircle from '../../../src/components/TrickCircle.vue';
import { sortHand, SUIT_SYMBOLS, suitOf } from '../../../shared/cards.js';
import { suitMsg } from '../../../shared/messages.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import Final from './Final.vue';
import RoundResult from './RoundResult.vue';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] }, // Recent moves: messages, kept by the page (see log.js)
});
const { t, text, list } = useGameText();

// A transient warning (why a card cannot be played), cleared whenever the phase, turn, or round changes.
const hint = ref('');
watch(
  () => [props.state.phase, props.state.turn, props.state.round?.number],
  () => (hint.value = ''),
);

// This player's seat number.
const you = computed(() => props.state.you);
// True once the game is over.
const finished = computed(() => props.state.phase === 'finished');
// All seats in seat order.
const seats = computed(() => props.state.seats);
// The current round's details (number, cards, trump, dealer).
const round = computed(() => props.state.round);
// Your hand sorted for display, with the trump suit grouped as the round dictates.
const hand = computed(() => sortHand(props.state.hand, props.state.round?.trump));
// Returns the name of a seat, or '' if there is none.
const nameOf = (seat) => seats.value[seat]?.name ?? '';
// True when it is your turn to nominate or play.
const myTurn = computed(() => props.state.turn === you.value);
// Sum of all nominations made so far (a player who has not nominated counts as 0).
const total = computed(() => seats.value.reduce((sum, s) => sum + (s.bid ?? 0), 0));
// True when every seat has nominated.
const everyoneNominated = computed(() => seats.value.every((s) => s.bid !== null));
// Names of players who have not yet closed the round scores (only meaningful in the roundEnd phase).
const waitingFor = computed(() => (props.state.phase === 'roundEnd' ? seats.value.filter((s) => !s.ready).map((s) => s.name) : []));
// The most recently finished round's result, or null before any round has finished.
const lastRound = computed(() => props.state.rounds.at(-1) ?? null);
// The seat object of the instant winner, or null if there is none.
const instantWinner = computed(() => (props.state.instantWin === null || props.state.instantWin === undefined ? null : (seats.value[props.state.instantWin] ?? null)));
// True when it is the nomination phase and your turn, which enables the nomination buttons.
const nominating = computed(() => props.state.phase === 'nominating' && myTurn.value);

/** Everyone clockwise from the viewer, as TrickCircle wants them. */
const ordered = computed(() => seats.value.map((_, i) => seats.value[(you.value + i) % seats.value.length]).map((s) => ({ key: s.seat, name: s.name, ...s })));
// Everyone except you, in clockwise order from you.
const others = computed(() => ordered.value.slice(1));
/**
 * The short line under an opponent's name: what they nominated and how many tricks they have won so far.
 * @param {object} seat  a seat object from the state (seat, bid, tricks)
 * @returns {string} the note text
 * Side effects: none.
 */
function noteFor(seat) {
  if (seat.bid === null) {
    if (props.state.phase === 'nominating' && props.state.turn === seat.seat) return t('table.nominating');
    return seat.seat === props.state.round?.dealer ? t('table.dealer') : t('table.notYetNominated'); // the dealer nominates last
  }
  return props.state.phase === 'nominating' ? t('table.nominated', { bid: seat.bid }) : t('table.nominatedWon', { bid: seat.bid, tricks: seat.tricks });
}
// Opponents in the shape OpponentHands expects (name, card count, note, away, and current-turn flags).
const opponents = computed(() => others.value.map((s) => ({ key: s.seat, name: s.name, cards: s.cards, note: noteFor(s), away: Boolean(s.away && !s.bot), current: s.seat === props.state.turn })));

// Another player's details (cards in hand, nomination, dealer) open from their chip in the score bar: one at a time,
// floating over the top of the main area so that nothing moves.
// The standard scoreboard (players plus the finished rounds), built by the server like every other game's.
const board = computed(() => props.state.scoreboard);
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => board.value.players,
  hostId: () => props.state.hostSeat,
  isHost: () => props.state.hostSeat === you.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
// The seat whose popup is open (may be yours), or null.
const opened = computed(() => ordered.value.find((o) => o.seat === openId.value) ?? null); // yours too: your own summary

// CSS class that colours the trump label red for hearts and diamonds.
const trumpClass = computed(() => (round.value.trump === 'H' || round.value.trump === 'D' ? 'red' : ''));
// The trump suit's name (the site's word for the suit), or the game's "no trumps".
const trumpText = computed(() => (round.value.trump ? text(suitMsg(round.value.trump)) : t('noTrumps')));
// A seat's name, with the site's "(you)" after your own, as the scoreboard writes it.
const named = (seat) => (seat.seat === you.value ? `${seat.name} ${t('common.youBracketed')}` : seat.name);
// True when you are the dealer this round.
const imDealer = computed(() => round.value.dealer === you.value);
const MOST_CARDS = 7; // the most cards in a hand: the nomination zone always has room for 0 to this
// The nomination numbers to show, 0 up to the cards dealt (capped at the most a hand can hold).
const options = computed(() => Array.from({ length: Math.min(MOST_CARDS, round.value.cards) + 1 }, (_, n) => n));

// The cards in the middle: the current trick, or the last trick while the round-end scores are showing.
const plays = computed(() => {
  const trick = props.state.trick.length ? props.state.trick : props.state.phase === 'roundEnd' ? (props.state.lastTrick?.plays ?? []) : [];
  return trick.map((p) => ({ key: p.seat, card: p.card }));
});
// Seat that won the trick on show, or null when the trick is unfinished.
const winnerKey = computed(() => (props.state.trick.length ? props.state.trickWinner : props.state.phase === 'roundEnd' ? (props.state.lastTrick?.winner ?? null) : null));

// The one-line headline for the Status box describing what is happening now.
const headline = computed(() => {
  const { phase } = props.state;
  if (phase === 'nominating') return myTurn.value ? t('status.yourTurnNominate') : t('status.waitingNominate', { name: nameOf(props.state.turn) });
  if (phase === 'playing') {
    if (props.state.turn === null) return t('status.winsTrick', { name: nameOf(props.state.trickWinner) });
    return myTurn.value ? t('status.yourTurnPlay') : t('status.waitingPlay', { name: nameOf(props.state.turn) });
  }
  if (phase === 'roundEnd') return seats.value[you.value].ready ? t('status.waitingReady', { names: list(waitingFor.value) }) : t('status.roundOver');
  if (finished.value) return instantWinner.value ? t('status.winsInstantly', { name: instantWinner.value.name }) : t('status.gameOver');
  return '';
});
// True when it is your move (nominate, play, or close the round scores), which highlights the Status box.
const mineNow = computed(
  () =>
    !finished.value &&
    ((props.state.phase === 'nominating' && myTurn.value) ||
      (props.state.phase === 'playing' && myTurn.value && props.state.turn !== null) ||
      (props.state.phase === 'roundEnd' && !seats.value[you.value].ready)),
);
// Extra Status lines: the hint, the suggestion, the dealer's forbidden number, and the follow-suit reminder.
const statusLines = computed(() => {
  const lines = [];
  if (hint.value) lines.push({ text: hint.value, tone: 'warn' });
  if (props.state.phase === 'nominating') {
    if (myTurn.value && props.state.suggestion != null) {
      lines.push({ text: t('status.suggestion', { n: props.state.suggestion }), tone: 'muted' });
    }
    if (myTurn.value && imDealer.value && props.state.forbidden !== null) {
      lines.push(t('status.dealerForbidden', { number: props.state.forbidden, cards: round.value.cards }));
    } else if (myTurn.value && imDealer.value) {
      lines.push(t('status.dealerFree', { cards: round.value.cards }));
    } else if (!everyoneNominated.value && round.value.dealer === props.state.turn) {
      lines.push({ text: t('status.dealerLast', { name: nameOf(round.value.dealer), number: props.state.forbidden }), tone: 'muted' });
    }
  }
  if (props.state.phase === 'playing' && myTurn.value && hand.value.some((c) => props.state.legal?.[c])) lines.push({ text: t('status.followSuit'), tone: 'muted' });
  if (finished.value && instantWinner.value) lines.push({ text: t('status.instantHow', { round: text(lastRound.value?.label) }), tone: 'muted' });
  return lines;
});

/**
 * Handles a click on a card in your hand: shows why it is illegal, or plays it.
 * @param {number|string} card  the card id clicked
 * @returns {void}
 * Side effects: sets or clears `hint`; sends a 'play' request to the server when the card is legal.
 */
function pick(card) {
  const reason = props.state.legal?.[card];
  if (reason) {
    hint.value = text(reason);
    return;
  }
  hint.value = '';
  props.send('play', { card });
}

// The sizes follow the room the frame leaves, never the game, so nothing changes size while playing.
const TOP_RESERVE = 124; // pixels kept clear along the top for an opponent's hand
const TOP_HANDS = [1, 3, 5, 6]; // how many opponents there are when one sits along the top, over the trick
const CARD_REM = { md: 4.4, lg: 5.8 };
// The hand is spread in an arc when there is room: the arc's middle cards stand higher than a flat row's, by its sag.
// Returns how much higher (px) the middle cards of an arc stand than a flat row's, for a card size ('md' or 'lg').
const arcSag = (size) => 8 * CARD_REM[size] * (1 - Math.cos(((MOST_CARDS - 1) / 2) * 3.6 * (Math.PI / 180)));
const ZOOM_MAX = 1.6;
/**
 * Works out the hand size, whether it is fanned and the trick zoom from the room the frame gives the table.
 * @param {{height: number, minimised?: boolean}} area  the main area's slot props
 * @returns {{hand: string, fanned: boolean, zoom: number}} card size, fan on or off, trick zoom factor
 * Side effects: none.
 */
const roomFor = (area) => {
  const handLarge = area.height >= 600;
  const size = handLarge ? 'lg' : 'md';
  // Returns the height (px) left for the trick once a hand of the given height (rem) is allowed for.
  const fromRoom = (handRem) => area.height - (0.4 + handRem) * 16 - 8 - (TOP_HANDS.includes(others.value.length) ? TOP_RESERVE : 0); // the hand and the gap above it
  const flat = handLarge ? 9.6 : 7.6; // a card and the fan's lift for the one under the pointer
  const arc = flat + arcSag(size);
  // The arc is used when the minimised boxes have given the table more room, or when the trick is already as big as it
  // gets and there is still room to spare (a large screen).
  const fanned = Boolean(area.minimised) || fromRoom(arc) / 242 >= ZOOM_MAX;
  // The trick is drawn large and then scaled to the room that is left (never to what is on the table).
  return { hand: size, fanned, zoom: Math.max(0.8, Math.min(ZOOM_MAX, fromRoom(fanned ? arc : flat) / 242)) };
};
</script>

<template>
  <GameFrame class="whist-table" :main-span="8">
    <template #scorebar>
      <ScoreBoard :players="board.players" :rounds="board.rounds" :finished="finished && !instantWinner" :low-is-better="false" :awaiting="state.phase === 'roundEnd' && !seats[you].ready" :waiting="waitingFor" :sticky="false" v-bind="scoreProps" @continue="send('next')">
        <template #round>
          <p v-if="instantWinner" class="instant-note" role="status"><strong>{{ t('status.winsInstantly', { name: named(instantWinner) }) }}</strong> {{ t('status.instantHow', { round: text(lastRound?.label) }) }}</p>
          <RoundResult v-if="lastRound" :round="lastRound" :seats="seats" :you="you" />
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <div class="arena">
        <PlayerPopup v-if="popupProps" v-bind="popupProps">
          <dl v-if="opened" class="facts">
            <dt>{{ t('popup.dealer') }}</dt>
            <dd>{{ opened.seat === round.dealer ? t('popup.yes') : t('popup.no') }}</dd>
            <dt>{{ t('popup.cardsInHand') }}</dt>
            <dd>{{ opened.cards }}</dd>
            <dt>{{ t('popup.nomination') }}</dt>
            <dd>
              <template v-if="opened.bid !== null">{{ state.phase === 'nominating' ? t('table.nominated', { bid: opened.bid }) : t('table.nominatedWon', { bid: opened.bid, tricks: opened.tricks }) }}</template>
              <template v-else-if="state.phase === 'nominating' && state.turn === opened.seat">{{ t('popup.choosing') }}</template>
              <template v-else>{{ t('popup.notYet') }}</template>
            </dd>
            <dt>{{ t('popup.score') }}</dt>
            <dd>{{ opened.score }}</dd>
          </dl>
        </PlayerPopup>

        <Final v-if="finished" class="zone-wide" :state="state" :send="send" />
        <template v-else>
          <div class="opponents"><OpponentHands :opponents="opponents" :max="MOST_CARDS" /></div>
          <div class="centre" :style="{ paddingTop: TOP_HANDS.includes(others.length) ? `${TOP_RESERVE}px` : undefined }" aria-live="polite">
            <TrickCircle :style="{ zoom: roomFor(area).zoom }" :seats="ordered" :plays="plays" :winner-key="winnerKey" :trump="round.trump ?? ''" size="lg" labels />
          </div>
          <section class="nominate" :class="{ live: nominating, hidden: state.phase !== 'nominating' }" :aria-label="t('table.yourNomination')">
            <h3>{{ t('table.yourNomination') }}</h3>
            <div class="numbers">
              <button
                v-for="n in options"
                :key="n"
                class="number"
                :class="{ forbidden: n === state.forbidden && nominating, suggested: n === state.suggestion && nominating }"
                :disabled="!nominating || n === state.forbidden"
                :title="n === state.forbidden && nominating ? t('table.forbiddenTitle') : n === state.suggestion && nominating ? t('table.suggestedTitle') : ''"
                @click="send('nominate', { number: n })"
              >{{ n }}</button>
            </div>
          </section>
        </template>

        <div class="mine">
          <CardFan class="hand" role="group" :aria-label="t('table.yourHand')" :items="hand" :item-key="(card) => card" :size="roomFor(area).hand" :max="MOST_CARDS" :straight="!roomFor(area).fanned">
            <template #default="{ item: card }">
              <div class="slot" :title="state.legal?.[card] ? text(state.legal[card]) : undefined">
                <PlayingCard :card="card" :size="roomFor(area).hand" :clickable="state.phase === 'playing' && myTurn" :dimmed="Boolean(state.legal?.[card])" :trump="Boolean(round.trump) && suitOf(card) === round.trump" @pick="pick" />
              </div>
            </template>
          </CardFan>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingPlayed')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :popup="false" :lines="statusLines">
        <template #facts>
          <strong>{{ t('facts.round', { n: round.number, total: round.total }) }}</strong>
          <span>{{ t('facts.cardsEach', { count: round.cards }, round.cards) }}</span>
          <span>{{ t('facts.dealer', { name: named(seats[round.dealer]) }) }}</span>
          <span class="tally">
            <template v-if="seats[you].bid !== null">{{ state.phase === 'nominating' ? t('facts.youNominated', { bid: seats[you].bid }) : t('facts.youNominatedWon', { bid: seats[you].bid, tricks: seats[you].tricks }) }}</template>
            <template v-else>{{ t('facts.notNominated') }}</template>
          </span>
          <span class="trump" :class="trumpClass" :title="t('facts.trumpsTitle', { trump: trumpText })">{{ t('facts.trumps') }} <b><span v-if="round.trump" aria-hidden="true">{{ SUIT_SYMBOLS[round.trump] }}</span> {{ trumpText }}</b></span>
          <span v-if="state.phase === 'nominating'">{{ t('facts.nominatedTotal', { total, count: round.cards }, round.cards) }}</span>
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
.tally b {
  color: var(--parchment);
}
/* The trump suit drawn like one of its cards: the theme's trump face, and the suit's own ink (black or red) as on the cards. */
.trump b {
  text-transform: capitalize;
  padding: 0.05rem 0.45rem;
  border-radius: 4px;
  background: var(--trump, #8fd3f0);
  color: #1c1c1f;
}
.trump.red b {
  color: #b4281f;
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
.number.suggested {
  /* Drawn with the border and a ring, never the size, so the row does not move when the suggestion appears. */
  border-color: var(--amber);
  box-shadow: 0 0 0 2px var(--amber);
  font-weight: 700;
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
  align-self: center; /* the fan is as wide as a full hand and keeps its size as cards are played */
}
.slot {
  width: 100%;
  height: 100%;
  border-radius: 8px;
}
</style>
