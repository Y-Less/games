<script setup>
// The card table, in the standard GameFrame: the score bar on top; the table itself (the other seats' face-down
// fans at the edges, the trick in the middle, your hand fanned at the bottom); and the two boxes along the bottom, Recent
// moves and Status. Every word about what is happening (turns, instructions, hand and trick numbers, the target, the
// passing direction) is in Status, so the table holds only cards, names and scores. The table is drawn at one design size
// and scaled by the window (see `scale`), so nothing changes size or position while a game is played.
//
// Props: state (the server's view), send (function: (event, payload) -> Promise<{ ok, error }>), log (Recent moves as
// messages, kept by Hearts.vue).
// Emits: none. Slots: none (it fills GameFrame's scorebar, main, log and status slots).
// Side effects: sends 'pass', 'play', 'claim', 'next', 'again', 'removeBot' and 'kick' requests; two watchers on the view
// clear the chosen pass cards and the warning message when the hand or the turn moves on.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { cardMsg } from '../../../shared/messages.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import CardFan from '../../../src/components/CardFan.vue';
import OpponentHands from '../../../src/components/OpponentHands.vue';
import TrickCircle from '../../../src/components/TrickCircle.vue';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] }, // Recent moves: messages, kept by the page (see log.js)
});
const { t, text, list } = useGameText();

const board = ref(null); // the ScoreBoard, so "See the scores" can open its pop-up
const picks = ref([]); // the cards chosen to pass, before they are confirmed
const message = ref(''); // a warning for Status (why a card cannot be played)

const s = computed(() => props.state); // the view as a computed, so everything below recalculates when it changes
// How many players are at the table.
const count = computed(() => s.value.seatCount);
// The seat object `rel` places clockwise from you (0 is you); returns it from the view.
const seatAt = (rel) => s.value.seats[(s.value.you + rel) % count.value];
// The seat number `rel` places clockwise from you (0 is you).
const seatIndex = (rel) => (s.value.you + rel) % count.value;
// Cards dealt to each player this game (varies with the number of players).
const cardsEach = computed(() => s.value.deal.cardsEach);
// How many cards each player passes.
const passCount = computed(() => s.value.deal.passCount);
// A seat's name, or '' for an empty seat.
const nameOf = (seat) => s.value.seats[seat]?.name ?? '';
// Which phase the hand is in (the next four are exactly one true at a time).
const passing = computed(() => s.value.phase === 'passing');
const finished = computed(() => s.value.phase === 'finished');
const handEnd = computed(() => s.value.phase === 'handEnd');
const playing = computed(() => s.value.phase === 'playing');
// The cards you received are marked only until the first card of the hand is played.
const showReceived = computed(() => playing.value && s.value.trickNumber === 1 && !s.value.trick.length);
// You may play now: the server only sends the legal-card map on your turn.
const myTurn = computed(() => Boolean(s.value.legal));
const claimable = computed(() => playing.value && Boolean(s.value.canClaim)); // you lead and cannot lose another trick
// The seats around the trick circle, starting with you, as { key, name }.
const circleSeats = computed(() => Array.from({ length: count.value }, (_, rel) => ({ key: seatIndex(rel), name: nameOf(seatIndex(rel)) })));
// The cards in the current trick as { key (the seat), card }; none outside the playing phase.
const circlePlays = computed(() => (playing.value ? s.value.trick.map((p) => ({ key: p.seat, card: p.card })) : []));
/**
 * The small note under an opponent's cards: passing progress, or the tricks they have taken.
 * @param {number} rel  places clockwise from you (1 or more)
 * @returns {string} the note, or '' when there is nothing to say
 * Side effects: none.
 */
const oppNote = (rel) => {
  const seat = seatAt(rel);
  if (passing.value) return seat.passed ? t('table.passed') : t('table.choosing');
  return seat.tricks ? t('table.tricks', { count: seat.tricks }, seat.tricks) : '';
};
// The others, clockwise from you: the player after you first.
const opponents = computed(() =>
  Array.from({ length: count.value - 1 }, (_, i) => i + 1).map((rel) => {
    const seat = seatAt(rel);
    return { key: seatIndex(rel), name: seat.name, cards: seat.cards, note: oppNote(rel), away: !seat.online, current: s.value.turn === seatIndex(rel) };
  }),
);
// Whether the hand just finished was a shot at the moon (changes how the scores are signed).
const isMoonRound = computed(() => s.value.lastHand?.moon != null);
// Your own seat object.
const you = computed(() => s.value.seats[s.value.you]);
// Names of the players who have not yet closed the hand's scores (only at the end of a hand).
const waitingFor = computed(() => (handEnd.value ? s.value.seats.filter((seat) => !seat.ready).map((seat) => seat.name) : []));
// The winners' names (empty until the game is over).
const winnerNames = computed(() => (s.value.winners ?? []).map(nameOf));
// Whether you are the host (who gets Play again and the Remove button).
const isHost = computed(() => s.value.hostSeat === s.value.you);

// Another player's details open from their chip in the score bar (the standard player pop-up, which also has the
// host's Remove button).
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostSeat,
  isHost: () => isHost.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
// The seat whose chip was clicked in the score bar, or null when no pop-up is open.
const opened = computed(() => s.value.seats.find((x) => x && x.seat === openId.value) ?? null);

// ---- the words, all of them in the Status box ----
// The headline of the Status box for the phase, as one sentence ('' when there is nothing to say).
const status = computed(() => {
  if (finished.value) {
    if (winnerNames.value.length > 1) return t('status.tie', { names: list(winnerNames.value) });
    return t('status.wins', { name: winnerNames.value[0], score: s.value.scoreboard.players.find((p) => p.id === s.value.winners[0])?.score });
  }
  if (passing.value) return s.value.pass.chosen ? t('status.waitingOthersChoose') : t('status.choose', { label: text(s.value.pass.label), count: passCount.value, name: s.value.pass.toName });
  if (playing.value) {
    if (s.value.trickWinner !== null) return t('status.takesTrick', { name: nameOf(s.value.trickWinner) });
    if (myTurn.value) return s.value.trickNumber === 1 && !s.value.trick.length ? t('status.leadOpening', { card: text(cardMsg(s.value.deal.openingCard)) }) : t('status.yourTurn');
    return s.value.turn === null ? '' : t('status.waitingFor', { name: nameOf(s.value.turn) });
  }
  if (handEnd.value) return you.value.ready ? t('status.waitingReady', { names: list(waitingFor.value) }) : t('status.handOver', { n: s.value.lastHand?.hand });
  return '';
});
// Whether it is your move (highlights the Status box).
const mine = computed(() => !finished.value && (myTurn.value || (passing.value && !s.value.pass.chosen)));
// The further Status lines as { text, tone }, which depend on the phase; tone only picks the colour.
const statusLines = computed(() => {
  const lines = [];
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  if (passing.value && !s.value.pass.chosen) lines.push({ text: t('status.pick', { count: passCount.value, chosen: picks.value.length }), tone: 'muted' });
  if (passing.value && s.value.pass.fromName) lines.push({ text: t('status.receive', { count: passCount.value, name: s.value.pass.fromName }), tone: 'muted' });
  if (claimable.value) lines.push({ text: t('status.claimable'), tone: 'mine' });
  if (s.value.received.length && showReceived.value) lines.push({ text: t('status.received'), tone: 'muted' });
  if (s.value.lastTrick && playing.value && !s.value.trick.length) lines.push({ text: t('status.lastTrick', { name: nameOf(s.value.lastTrick.winner) }), tone: 'muted' });
  if (handEnd.value && moonMessage.value) lines.push({ text: moonMessage.value, tone: 'mine' });
  if (finished.value) {
    lines.push({ text: isHost.value ? t('status.hostAgain') : t('status.againHost'), tone: 'muted' });
  }
  return lines;
});
// A sentence about the last hand's shot at the moon, or '' if nobody shot it.
const moonMessage = computed(() => {
  const moon = s.value.lastHand?.moon;
  if (moon == null) return '';
  const points = s.value.deal.handPoints;
  return s.value.settings.moon === 'self' ? t('status.moonSelf', { name: nameOf(moon), points }) : t('status.moonOthers', { name: nameOf(moon), points });
});

// A new hand or phase starts again with no cards chosen to pass.
watch(
  () => `${s.value.phase}:${s.value.handNumber}`,
  () => (picks.value = []),
);
// A warning is only about the moment it was shown: any play clears it.
watch(
  () => `${s.value.turn}:${s.value.trick.length}`,
  () => (message.value = ''),
);

/**
 * A card in your hand was clicked: while passing it is chosen or unchosen; on your turn it is played if it is legal, otherwise
 * the reason is shown in Status.
 * @param {string} card  the card's code
 * @returns {void}
 * Side effects: clears the message; changes picks; may set the message; may send 'play' (through submit).
 */
function pick(card) {
  message.value = '';
  if (passing.value && !s.value.pass.chosen) {
    if (picks.value.includes(card)) picks.value = picks.value.filter((c) => c !== card);
    else if (picks.value.length < passCount.value) picks.value = [...picks.value, card];
    return;
  }
  if (!s.value.legal || sending.value) return;
  const reason = s.value.legal[card];
  if (reason) message.value = text(reason);
  else submit('play', { card });
}

// One card goes at a time: until the server has answered, the card just clicked is still drawn in the hand, and a second
// click on it (a double click, say) would only come back as "That card is not in your hand."
const sending = ref(false);
/**
 * Sends a request while blocking further card clicks until the server answers.
 * @param {string} event  the request name, such as 'play' or 'claim'
 * @param {object} [payload]  its parameters
 * @returns {Promise<void>} resolves when the server has answered (its reply is not examined)
 * Side effects: sets and clears `sending`; sends the request.
 */
async function submit(event, payload) {
  sending.value = true;
  try {
    await props.send(event, payload);
  } finally {
    sending.value = false;
  }
}

/**
 * Sends the cards chosen to pass.
 * @returns {Promise<void>} resolves when the server has answered
 * Side effects: sends 'pass'; clears picks if it is accepted.
 */
async function confirmPass() {
  const reply = await props.send('pass', { cards: picks.value });
  if (reply.ok) picks.value = [];
}

// Once you have passed, those cards are gone from your hand while the others choose (the fan keeps its size, see `max`).
// (the hand as drawn: your cards less any already passed)
const shownHand = computed(() => (passing.value && s.value.pass.chosen ? s.value.hand.filter((card) => !s.value.pass.chosen.includes(card)) : s.value.hand));

// Whether cards in your hand can be clicked now (choosing cards to pass, or your turn to play).
const interactive = computed(() => (passing.value && !s.value.pass.chosen) || myTurn.value);
// Whether a card is drawn dimmed: it is your turn and the server gave a reason it cannot be played.
const dimmed = (card) => myTurn.value && s.value.legal[card] !== null;
// The reason a card cannot be played, for its hover title ('' if it can or it is not your turn).
const reasonFor = (card) => (myTurn.value && s.value.legal[card] ? text(s.value.legal[card]) : '');
// What a seat took this hand, for the summary and the pop-up: "3 hearts, Queen of Spades, Jack of Diamonds".
const takenText = (details) => `${t('table.hearts', { count: details.hearts }, details.hearts)}${details.queen ? t('table.queen') : ''}${s.value.settings.jackOfDiamonds && details.jack ? t('table.jack') : ''}`;

// ---- your hand, from 7 to 17 cards ----
// The flat row (or the fan) of a deal bigger than 13 cards is squeezed into the width of the 13-card hand, and a smaller
// deal is narrower. The box is fixed for the deal, so nothing moves while cards are played.
const CARD_W = 5.8; // rem, a large card
const ROW_W = 12 * 0.48 * CARD_W + CARD_W + 0.6; // the flat row of 13 cards
const FAN_SPAN = 12 * 3.6; // degrees from the first card to the last in the 13-card fan
// How tightly the hand is drawn for this deal size: `overlap` (flat row) and `step` (degrees between cards in the fan).
const handLook = computed(() => {
  const n = cardsEach.value;
  const overlap = n <= 13 ? 0.48 : (ROW_W - CARD_W - 0.6) / ((n - 1) * CARD_W);
  const step = Math.min(6, Math.max(1, FAN_SPAN / Math.max(1, n - 1)));
  return { overlap, step };
});
/**
 * The style that centres the hand: its width depends on the deal size and on whether it is fanned or a flat row.
 * @param {boolean} fanned  true for the arc, false for the flat row
 * @returns {{ marginLeft: string }} a negative left margin of half the width, in rem
 * Side effects: none.
 */
const handStyle = (fanned) => {
  const n = cardsEach.value;
  const { overlap, step } = handLook.value;
  const width = fanned ? 2 * 8 * CARD_W * Math.sin(((n - 1) / 2) * step * (Math.PI / 180)) + CARD_W + 0.6 : (n - 1) * overlap * CARD_W + CARD_W + 0.6;
  return { marginLeft: `${(-width / 2).toFixed(2)}rem` };
};
// The hand is spread in an arc when it fits: the arc's middle cards stand higher than a flat row's (by its sag), so it
// needs that much more room between the trick and the bottom edge. The design leaves CLEAR rem there; a window taller
// than the table can be scaled to (see `scale`) leaves more. The minimised boxes also give the arc its room.
const CLEAR = 2.9; // rem between the lowest played card and the top of a flat hand, in the design
// How far (rem) the middle cards of the fanned hand stand higher than the flat row's (the arc's sag).
const arcSag = computed(() => 8 * CARD_W * (1 - Math.cos(((cardsEach.value - 1) / 2) * handLook.value.step * (Math.PI / 180))));
/**
 * Whether the hand can be shown as an arc in the room the frame gives (otherwise it is a flat row).
 * @param {{ minimised?: boolean, height: number }} area  the main area given by the frame
 * @returns {boolean}
 * Side effects: none (reads the root font size through rem()).
 */
function arcFits(area) {
  if (area.minimised) return true;
  const s = scale(area);
  const spare = area.height / rem() - DESIGN_H * s; // rem the table cannot use because it stops growing
  return arcSag.value * s + 0.4 <= CLEAR * s + spare;
}

// ---- fitting the room ----
// The table is drawn at a design height of DESIGN_H rem and every piece is scaled by one factor worked out from the
// height the frame gives it, so it is the same at every moment of a game and fills the window at any desktop size.
const DESIGN_H = 34;
// The size of a rem in pixels (the root font size; 16 if it cannot be read).
const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
// The one factor every piece of the table is scaled by: the area's height over the design height, kept between 0.55 and 1.4.
const scale = (area) => Math.max(0.55, Math.min(1.4, area.height / (DESIGN_H * rem())));
</script>

<template>
  <GameFrame class="table-view">
    <template #scorebar>
      <ScoreBoard
        ref="board"
        :players="state.scoreboard.players"
        :rounds="state.scoreboard.rounds"
        :low-is-better="state.scoreboard.lowIsBetter"
        :target="state.scoreboard.target"
        split-totals
        :finished="finished"
        :awaiting="handEnd && !you.ready"
        :waiting="waitingFor"
        :sticky="false"
        v-bind="scoreProps"
        @continue="send('next')"
      >
        <template #round>
          <section v-if="state.lastHand && (handEnd || finished)" class="summary stack" :aria-label="t('table.thisHand')">
            <p v-if="moonMessage" class="moon" role="status">{{ moonMessage }}</p>
            <ul class="taken">
              <li v-for="(seat, i) in state.seats" :key="i" :class="{ me: i === state.you }">
                <strong>{{ seat.name }}</strong>
                <span class="muted">{{ takenText(state.lastHand.details[i]) }}</span>
                <b>{{ state.lastHand.points[i] > 0 && !isMoonRound ? '+' : '' }}{{ state.lastHand.points[i] }}</b>
              </li>
            </ul>
          </section>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>{{ t('popup.score') }}</dt>
          <dd>{{ opened.score }}</dd>
          <dt>{{ t('popup.cardsInHand') }}</dt>
          <dd>{{ opened.cards }}</dd>
          <template v-if="state.phase !== 'passing'">
            <dt>{{ t('popup.tricksTaken') }}</dt>
            <dd>{{ opened.tricks }}</dd>
            <dt>{{ t('popup.heartsTaken') }}</dt>
            <dd>{{ opened.hearts }}<template v-if="opened.queen">{{ t('table.queen') }}</template><template v-if="state.settings.jackOfDiamonds && opened.jack">{{ t('table.jack') }}</template></dd>
            <dt>{{ t('popup.pointsThisHand') }}</dt>
            <dd>{{ opened.points }}</dd>
          </template>
          <dt v-else>{{ t('popup.passing') }}</dt>
          <dd v-if="state.phase === 'passing'">{{ opened.passed ? t('popup.hasChosen') : t('popup.stillChoosing') }}</dd>
        </dl>
      </PlayerPopup>
      <section class="felt" :aria-label="t('table.label')" :style="{ '--s': scale(area) }">
        <OpponentHands :opponents="opponents" :max="cardsEach" />

        <TrickCircle class="trick" :seats="circleSeats" :plays="circlePlays" :winner-key="state.trickWinner" size="lg" />

        <CardFan class="my-fan hand" :class="{ fanned: arcFits(area), minimised: area.minimised }" role="group" :style="handStyle(arcFits(area))" :aria-label="t('table.yourHand')" :items="shownHand" :item-key="(card) => card" size="lg" :max="cardsEach" :step="handLook.step" :overlap="handLook.overlap" :straight="!arcFits(area)">
          <template #default="{ item: card }">
            <div class="slot" :class="{ received: showReceived && state.received.includes(card) }" :title="reasonFor(card)">
              <PlayingCard :card="card" size="lg" :clickable="interactive" :selected="picks.includes(card)" :dimmed="dimmed(card)" @pick="pick" />
            </div>
          </template>
        </CardFan>
        <div class="row confirm" :class="{ hidden: !(passing && !state.pass.chosen) && !claimable }">
          <button v-if="claimable" class="primary claim" :disabled="sending" @click="submit('claim')">{{ t('table.claimAll') }}</button>
          <button v-else class="primary" :disabled="picks.length !== passCount" @click="confirmPass">{{ t('table.passThese', { chosen: picks.length, count: passCount }) }}</button>
        </div>
      </section>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingPlayed')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="mine" :popup="false" :lines="statusLines">
        <template #facts>
          <strong>{{ t('facts.hand', { n: state.handNumber }) }}</strong>
          <span v-if="playing || handEnd">{{ t('facts.trick', { n: state.trickNumber, total: state.deal.tricks }) }}</span>
          <span v-if="playing || handEnd">{{ state.heartsBroken ? t('facts.heartsBroken') : t('facts.heartsNotBroken') }}</span>
          <span>{{ t('facts.playTo', { n: state.scoreboard.target }) }}</span>
          <span v-if="state.settings.jackOfDiamonds">{{ t('facts.jack') }}</span>
        </template>
        <div v-if="finished" class="row">
          <button v-if="isHost" class="primary" @click="send('again')">{{ t('table.playAgain') }}</button>
          <button @click="board.show()">{{ t('table.seeScores') }}</button>
        </div>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
/* The table: no panel over the background (the background is the table). Pieces are placed on the frame's edges and
   scaled together by --s, so they never move. */
.felt {
  grid-column: 1 / -1;
  position: relative;
  height: 100%;
  min-height: 0;
}
.trick {
  position: absolute;
  left: 50%;
  top: calc(var(--s) * 9.4rem);
  margin-left: -8.1rem;
  transform-origin: 50% 0;
  transform: scale(var(--s));
}
.my-fan {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform-origin: 50% 100%;
  transform: scale(var(--s));
}
.my-fan.fanned.minimised {
  bottom: 1.2rem; /* and its outer corners drop low, so it sits higher to clear the minimised boxes */
}
.slot {
  width: 100%;
  height: 100%;
  border-radius: 8px;
}
.hidden {
  visibility: hidden;
}
.slot.received :deep(.playing-card) {
  outline: 2px solid var(--moss);
  outline-offset: 1px;
}
.confirm {
  position: absolute;
  left: 50%;
  top: calc(var(--s) * 15.8rem);
  transform-origin: 50% 50%;
  transform: translateX(-50%) scale(var(--s));
  z-index: 60;
  white-space: nowrap;
}
.moon {
  margin: 0;
  color: var(--amber);
  font-family: var(--display);
  font-size: 1.1rem;
}
.taken {
  list-style: none;
  margin: 0 0 0.8rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.taken li {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
}
.taken li span {
  flex: 1;
}
.taken li.me strong {
  color: var(--amber);
}
</style>
