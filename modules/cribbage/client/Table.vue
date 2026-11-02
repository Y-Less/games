<script setup>
// The Cribbage table, in the standard GameFrame: the score bar on top; the table (your pegging row and hand on the left,
// the board with the deck, starter and box on the right); what each opponent holds, shown over the table when you click their chip in the score bar; and the two boxes along the
// bottom, Recent moves (the scoring) and Status. Every word about what is happening (turns, instructions, the hand
// number, the dealer, the target, the deck and box counts, the result) is in Status. It is drawn for every phase after
// the lobby (discarding, pegging, the show and the end), so nothing changes size or position from one to the next.
//
// Props:
//   state  {Object}    required. The player's view (phases discard, play, show, finished).
//   send   {Function}  required. send(action, payload) returns a promise of { ok, error? }.
// Emits: none.
// Slots: none (fills GameFrame's scorebar and main slots, and the boxes below them).
// Side effects: sends play, discard, ready, kick and removeBot requests; keeps local `picked` cards (pruned when the
// hand changes, cleared when the phase changes); the player pop-up composable manages its own state.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import OpponentHands from '../../../src/components/OpponentHands.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import Board from './Board.vue';
import ShowHands from './ShowHands.vue';
import { seatColour } from './colours.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t, text, list } = useGameText();

// The cards chosen for the box during the discard phase (card codes).
const picked = ref([]);
// Template ref to the ScoreBoard (kept so it can be opened programmatically).
const scoreboard = ref(null);
// Shorthand for the view.
const s = computed(() => props.state);
// The current phase: discard, play, show or finished.
const phase = computed(() => s.value.phase);
// The viewer's seat index.
const me = computed(() => s.value.you);
// All seat records.
const seats = computed(() => s.value.seats);
// The viewer's own seat record.
const you = computed(() => seats.value[me.value]);
// Returns the seat `rel` places clockwise from the viewer.
const seatAt = (rel) => seats.value[(me.value + rel) % seats.value.length];
/**
 * Builds the small caption under an opponent's hand: dealer status and, while discarding, whether they have discarded.
 * @param {Object} seat  An opponent's seat record.
 * @returns {string} The caption ('' if there is nothing to say).
 * Side effects: none.
 */
const oppNote = (seat) => {
  const dealing = seat.seat === s.value.dealer;
  if (phase.value !== 'discard') return dealing ? t('table.dealer') : '';
  if (dealing) return t(seat.discarded ? 'table.dealerDiscarded' : 'table.dealerChoosing');
  return t(seat.discarded ? 'table.discarded' : 'table.choosing');
};
// The others, clockwise from you (the player after you first), face down.
const opponents = computed(() =>
  seats.value.slice(1).map((_, i) => {
    const seat = seatAt(i + 1);
    return { key: seat.seat, name: seat.name, cards: seat.cards, note: oppNote(seat), away: !seat.online, current: turn.value === seat.seat };
  }),
);
// The dealer's seat record.
const dealer = computed(() => seats.value[s.value.dealer]);
// True when the viewer deals (so the box is theirs).
const youDeal = computed(() => s.value.dealer === me.value);
// True during the pegging phase.
const inPlay = computed(() => phase.value === 'play');
// True once the game is over.
const finished = computed(() => phase.value === 'finished');
// Seat whose turn it is to peg, or -1 outside pegging.
const turn = computed(() => (inPlay.value ? s.value.play.turn : -1));
// True when it is the viewer's turn to peg.
const myTurn = computed(() => turn.value === me.value);
// The cards the viewer may legally play now, as a set.
const playable = computed(() => new Set(s.value.play?.playable ?? []));
// How many cards the viewer still has to put in the box (0 when done or not discarding).
const need = computed(() => s.value.need);
// Names of those who have not yet discarded.
const waitingFor = computed(() => seats.value.filter((x) => !x.discarded).map((x) => x.name));
// The winner's seat record once finished, else null.
const winner = computed(() => (finished.value ? seats.value[s.value.winner] : null));
// Final standings: seats with their place, sorted by place then score. Empty until finished.
const standings = computed(() => (finished.value ? seats.value.map((x) => ({ ...x, place: s.value.placements[x.seat] })).sort((a, b) => a.place - b.place || b.score - a.score) : []));
// Losers who finished below the skunk line. Empty until finished.
const skunked = computed(() => (finished.value ? seats.value.filter((x) => x.seat !== s.value.winner && x.score < s.value.skunkLine) : []));
// The score bar's players, with a ready flag added during the show.
const scorePlayers = computed(() => s.value.scoreboard.players.map((p) => ({ ...p, ready: phase.value === 'show' && Boolean(seats.value[p.id]?.ready) })));
// Names of those who have not yet closed the show (empty outside the show).
const waitingForReady = computed(() => (phase.value === 'show' ? seats.value.filter((x) => !x.ready).map((x) => x.name) : []));

watch(
  () => s.value.hand.join(),
  () => (picked.value = picked.value.filter((c) => s.value.hand.includes(c))),
);
watch(
  () => phase.value,
  () => (picked.value = []),
);

/**
 * Handles a click on a card in your hand: during the discard phase it toggles the card in the box selection (replacing
 * the oldest pick when full); during pegging on your turn it plays the card.
 * @param {string} card  The card code.
 * @returns {void}
 * Side effects: may change `picked`, or send a `play` request.
 */
function pick(card) {
  if (phase.value === 'discard') {
    if (!need.value) return;
    if (picked.value.includes(card)) picked.value = picked.value.filter((c) => c !== card);
    else if (picked.value.length < need.value) picked.value = [...picked.value, card];
    else picked.value = [...picked.value.slice(1), card];
  } else if (myTurn.value) {
    props.send('play', { card });
  }
}
/**
 * Sends the picked cards to the box.
 * @returns {Promise<void>}
 * Side effects: sends a `discard` request; clears `picked` on success.
 */
async function discard() {
  const reply = await props.send('discard', { cards: picked.value });
  if (reply?.ok) picked.value = [];
}

// An opponent's details (cards held, whether they have discarded, whose box it is, their pegs) stay hidden until you
// click their chip in the score bar: one at a time, floating at the top of the table, so nothing moves.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => scorePlayers.value,
  hostId: () => seats.value.find((x) => x.host)?.seat ?? null,
  isHost: () => Boolean(s.value.isHost),
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
// The seat record whose pop-up is open, or null.
const opened = computed(() => seats.value.find((o) => o.seat === openId.value) ?? null); // yours too: your own summary
/**
 * Builds the lines of an opponent's (or your own) pop-up: cards held, discard status, whose box it is, and the pegs.
 * @param {Object} o  A seat record.
 * @returns {string[]} One sentence per line.
 * Side effects: none.
 */
const detailLines = (o) => {
  const lines = [t('popup.cardsInHand', { count: o.cards }, o.cards)];
  const mine = o.seat === me.value;
  if (phase.value === 'discard') {
    if (mine) lines.push(t(o.discarded ? 'popup.youDiscarded' : 'popup.youChoosing'));
    else lines.push(t(o.discarded ? 'popup.discarded' : 'popup.choosing'));
  }
  if (o.seat === s.value.dealer) lines.push(t(mine ? 'popup.youDeal' : 'popup.deals'));
  else lines.push(youDeal.value ? t('popup.boxYours') : t('popup.boxOf', { name: dealer.value.name }));
  lines.push(t('popup.pegs', { score: o.score, back: o.back }));
  return lines;
};

// ---- the words, all of them in the Status box ----
// The Status box headline: whose move it is, or what the viewer must do.
const status = computed(() => {
  if (finished.value) return t(winner.value.seat === me.value ? 'status.youWin' : 'scoreboard.wins', { name: winner.value.name });
  if (phase.value === 'discard') {
    if (!need.value) return t('scoreboard.waitingFor', { names: list(waitingFor.value) });
    return youDeal.value ? t('status.chooseForYourBox', { count: need.value }, need.value) : t('status.chooseForBox', { count: need.value, name: dealer.value.name }, need.value);
  }
  if (inPlay.value) {
    if (!myTurn.value) return t('status.toPlay', { name: seats.value[turn.value].name });
    return t(playable.value.size ? 'status.yourTurnChoose' : 'status.yourTurn');
  }
  if (phase.value === 'show') return you.value.ready ? t('scoreboard.waitingFor', { names: list(waitingForReady.value) }) : t('status.closeScores');
  return '';
});
// True when the viewer has something to do (highlights the Status box).
const mine = computed(() => !finished.value && ((phase.value === 'discard' && Boolean(need.value)) || (inPlay.value && myTurn.value)));
// The extra Status lines, each { text, tone }: discard progress, the count restarting, and the final standings.
const statusLines = computed(() => {
  const lines = [];
  if (phase.value === 'discard' && need.value) lines.push({ text: t('status.chosen', { chosen: picked.value.length, count: need.value }), tone: 'muted' });
  if (inPlay.value) {
    const { sequence, previous } = s.value.play;
    if (!sequence.length) lines.push({ text: t(previous.length ? 'status.countRestarted' : 'status.nothingPlayed'), tone: 'muted' });
  }
  if (finished.value) {
    for (const x of standings.value) lines.push({ text: t(x.seat === me.value ? 'status.standingYou' : 'status.standing', { place: x.place, name: x.name, score: x.score }), tone: x.place === 1 ? 'mine' : '' });
    if (skunked.value.length) lines.push({ text: t('status.skunk', { names: list(skunked.value.map((x) => x.name)), line: s.value.skunkLine }), tone: 'muted' });
    lines.push({ text: t(s.value.isHost ? 'status.hostAgain' : 'status.againHost'), tone: 'muted' });
  }
  return lines;
});

// ---- fitting the room: the cards are sized from the height the frame gives the table ----
// Returns the card widths and box heights derived from the frame's height: hand, pegging row, piles, and the board's height.
// Pure: it only reads the area.
const dims = (area) => {
  const hand = Math.round(Math.max(52, Math.min(124, (area.height * 0.34) / 1.4))); // width of a card in your hand, px
  const peg = Math.round(hand * 0.8); // width of a card in the pegging row
  const pile = Math.round(Math.max(40, Math.min(64, area.height * 0.12))); // width of a card in the deck, starter and box
  const pilesHeight = Math.round(pile * 1.4 + 14 + 20);
  return { hand, peg, pile, pilesHeight, boardHeight: Math.max(120, area.height - pilesHeight - 8) };
};
// The opponents' hands sit over the pegging zone (above your hand): top centre for one, three or five opponents (so the
// zone is inset from the top), and left and right for two or more (inset from the sides). A hand is drawn about 0.3 of
// the zone's height deep (see OpponentHands), so that is how far the pegging row is kept away from each edge.
const OPPONENT_DEPTH = 0.31; // fraction of the zone's height an opponent's hand takes up
// Returns the padding that keeps the pegging zone clear of the opponents' hands (top for odd counts, sides for two or more).
const room = (area) => {
  const n = opponents.value.length;
  const d = dims(area);
  const depth = Math.round((area.height - (d.hand * 1.4 + 19)) * OPPONENT_DEPTH);
  return { paddingTop: n % 2 === 1 ? `${depth}px` : '', paddingInline: n >= 2 ? `${depth}px` : '' };
};
// The cards of the current pegging sequence, each { card, seat }.
const sequence = computed(() => (inPlay.value ? s.value.play.sequence : []));
// The previous (finished) sequence, shown faded until the next card is played.
const previous = computed(() => (inPlay.value && !sequence.value.length ? s.value.play.previous : []));
</script>

<template>
  <GameFrame class="table-view">
    <template #scorebar>
      <ScoreBoard ref="scoreboard" :players="scorePlayers" :rounds="state.scoreboard.rounds" :target="state.target" :finished="finished" :awaiting="phase === 'show' && !you.ready" :waiting="waitingForReady" :sticky="false" v-bind="scoreProps" running @continue="send('ready')">
        <template #round>
          <ShowHands v-if="state.show" :state="state" class="in-modal" />
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <div class="arena">
        <PlayerPopup v-if="popupProps" v-bind="popupProps">
          <div v-if="opened" class="seat-details">
            <p class="key">
              <span class="chip" :style="{ background: seatColour(opened.seat) }" />
              <span v-if="opened.seat === state.dealer" class="badge" :title="t('table.dealerTitle')">D</span>
            </p>
            <p v-for="line in detailLines(opened)" :key="line">{{ line }}</p>
          </div>
        </PlayerPopup>
        <div class="mine-col" :style="{ gridColumn: `span ${area.mainSpan}` }">
          <section class="zone" :aria-label="t('table.play')" :style="room(area)">
            <OpponentHands :opponents="opponents" :max="6" :base="28" />
            <template v-if="inPlay">
              <div class="count" :aria-label="t('table.count')">
                <span class="muted">{{ t('table.countLabel') }}</span>
                <strong>{{ state.play.count }}</strong>
              </div>
              <div class="seq" :class="{ dim: !sequence.length }" :style="{ '--w': `${dims(area).peg}px` }">
                <div v-for="(x, i) in sequence.length ? sequence : previous.map((card) => ({ card, seat: -1 }))" :key="`${x.card}-${i}`" class="peg-card">
                  <PlayingCard :card="x.card" size="sm" />
                  <span class="dot" :style="{ background: x.seat >= 0 ? seatColour(x.seat) : 'transparent' }" :title="x.seat >= 0 ? seats[x.seat].name : ''" />
                </div>
              </div>
            </template>
            <div v-else-if="phase === 'discard' && need" class="send">
              <button class="primary" :disabled="picked.length !== need" @click="discard">{{ t('table.sendToBox') }}</button>
            </div>
          </section>

          <section class="hand-area" :style="{ '--w': `${dims(area).hand}px` }">
            <div class="hand" :aria-label="t('table.yourHand')">
              <PlayingCard
                v-for="card in state.hand"
                :key="card"
                :card="card"
                clickable
                :selected="picked.includes(card)"
                :disabled="phase === 'discard' ? !need : !myTurn || !playable.has(card)"
                @pick="pick"
              />
            </div>
          </section>
        </div>

        <div class="right-col" :style="{ gridColumn: `span ${area.columns - area.mainSpan}` }">
          <div class="board-box" :style="{ height: `${dims(area).boardHeight}px` }">
            <Board :seats="state.seats" :target="state.target" :skunk-line="state.skunkLine" :you="state.you" />
          </div>
          <div class="piles" :style="{ '--w': `${dims(area).pile}px`, height: `${dims(area).pilesHeight}px` }">
            <div class="pile" :aria-label="t('table.deck')">
              <div class="slot-box"><PlayingCard :card="null" size="sm" /></div>
              <small class="muted">{{ t('table.deckLabel') }}</small>
            </div>
            <div class="pile" :aria-label="t('table.starter')">
              <div class="slot-box">
                <PlayingCard v-if="state.starter" :card="state.starter" size="sm" />
                <PlayingCard v-else :card="null" size="sm" class="faded" />
              </div>
              <small class="muted">{{ t('table.starterLabel') }}</small>
            </div>
            <div class="pile" :aria-label="t('table.box')">
              <div class="slot-box crib">
                <PlayingCard v-for="n in Math.max(state.cribCount, 1)" :key="n" :card="null" size="sm" :class="{ faded: !state.cribCount }" />
              </div>
              <small class="muted">{{ t('table.boxLabel') }}</small>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="state.log" newest-first :label="t('table.scoring')" :empty="t('table.nothingScored')" v-slot="{ entry }">
        <span class="entry"><span class="dot" :style="{ background: seatColour(entry.seat) }" />{{ text(entry) }}</span>
      </GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="mine" :popup="false" :lines="statusLines">
        <template #facts>
          <strong>{{ t('facts.hand', { n: state.handNo }) }}</strong>
          <span class="dealer"><span class="badge" :title="t('table.dealerTitle')">D</span>{{ youDeal ? t('facts.youDeal') : t('facts.deals', { name: dealer.name }) }}</span>
          <span>{{ t('facts.firstTo', { n: state.target }) }}</span>
          <span>{{ t('facts.deck', { count: state.deckCount }) }}</span>
          <span>{{ youDeal ? t('facts.yourBox', { count: state.cribCount }) : t('facts.box', { name: dealer.name, count: state.cribCount }) }}</span>
        </template>
        <div v-if="finished" class="row">
          <button v-if="state.isHost" class="primary" @click="send('again')">{{ t('table.playAgain') }}</button>
          <button @click="scoreboard.show()">{{ t('table.seeScores') }}</button>
        </div>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  min-height: 0;
}
.mine-col,
.right-col {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Your side: the pegging row fills what the hand leaves, and the hand sits at the bottom, the most prominent thing. */
.zone {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.6rem;
}
.count {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 5.5rem;
  flex: none;
}
.count strong {
  font-family: var(--display);
  font-size: 2.6rem;
  line-height: 1;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}
.seq {
  display: flex;
  align-items: flex-start;
  min-height: calc(var(--w) * 1.4 + 1rem);
  min-width: 0;
}
.seq.dim {
  opacity: 0.45;
}
.peg-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  flex: none;
}
.peg-card + .peg-card {
  margin-left: calc(var(--w) * -0.3);
}
.peg-card :deep(.playing-card.sm) {
  --w: inherit;
}
.dot {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  flex: none;
  display: inline-block;
}
.send {
  display: flex;
  justify-content: center;
}
.hand-area {
  flex: none;
  height: calc(var(--w) * 1.4 + 1.2rem);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.hand {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding-top: 1rem; /* room for a chosen card to rise */
}
.hand :deep(.playing-card.md) {
  --w: inherit;
}
.hand :deep(.playing-card.face:hover) {
  background: #fbf8f0;
  border-color: #b9b2a2;
}

/* The board and the three piles. */
.right-col {
  gap: 8px;
}
.board-box {
  flex: none;
  min-height: 0;
}
.board-box :deep(.board) {
  width: 100%;
  height: 100%;
  max-width: none;
}
.piles {
  flex: none;
  display: flex;
  justify-content: center;
  gap: 2.2rem;
}
.pile {
  width: calc(var(--w) * 1.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.pile :deep(.playing-card.sm) {
  --w: inherit;
}
.slot-box {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: calc(var(--w) * 1.4 + 0.8rem);
}
.crib :deep(.playing-card:not(:first-child)) {
  margin-left: calc(var(--w) * -0.6);
}
small {
  white-space: nowrap;
}
.faded {
  opacity: 0.25;
}

.chip {
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
  display: inline-grid;
  place-items: center;
  font-size: 0.75rem;
  font-weight: 700;
  flex: none;
}
.dealer {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

/* An opponent's details, in the panel of the standard player pop-up (opened from their chip in the score bar). */
.seat-details p {
  margin: 0;
  font-size: 0.9rem;
}
.seat-details .key {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.2rem;
}
.entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.in-modal {
  margin-bottom: 0.8rem;
}
</style>
