<script setup>
// The Cribbage table, in the standard GameFrame: the score bar on top; the table (your pegging row and hand on the left,
// the board with the deck, starter and crib on the right); what each opponent holds, shown over the table when you click their chip in the score bar; and the two boxes along the
// bottom, Recent moves (the scoring) and Status. Every word about what is happening (turns, instructions, the hand
// number, the dealer, the target, the deck and crib counts, the result) is in Status. It is drawn for every phase after
// the lobby (discarding, pegging, the show and the end), so nothing changes size or position from one to the next.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import Board from './Board.vue';
import ShowHands from './ShowHands.vue';
import { seatColour } from './colours.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const picked = ref([]);
const scoreboard = ref(null);
const s = computed(() => props.state);
const phase = computed(() => s.value.phase);
const me = computed(() => s.value.you);
const seats = computed(() => s.value.seats);
const you = computed(() => seats.value[me.value]);
const others = computed(() => seats.value.filter((x) => x.seat !== me.value));
const dealer = computed(() => seats.value[s.value.dealer]);
const youDeal = computed(() => s.value.dealer === me.value);
const inPlay = computed(() => phase.value === 'play');
const finished = computed(() => phase.value === 'finished');
const turn = computed(() => (inPlay.value ? s.value.play.turn : -1));
const myTurn = computed(() => turn.value === me.value);
const playable = computed(() => new Set(s.value.play?.playable ?? []));
const need = computed(() => s.value.need);
const cribOwner = computed(() => (youDeal.value ? 'your' : `${dealer.value.name}'s`));
const waitingFor = computed(() => seats.value.filter((x) => !x.discarded).map((x) => x.name));
const winner = computed(() => (finished.value ? seats.value[s.value.winner] : null));
const standings = computed(() => (finished.value ? seats.value.map((x) => ({ ...x, place: s.value.placements[x.seat] })).sort((a, b) => a.place - b.place || b.score - a.score) : []));
const skunked = computed(() => (finished.value ? seats.value.filter((x) => x.seat !== s.value.winner && x.score < s.value.skunkLine) : []));
const scorePlayers = computed(() => s.value.scoreboard.players.map((p) => ({ ...p, ready: phase.value === 'show' && Boolean(seats.value[p.id]?.ready) })));
const waitingForReady = computed(() => (phase.value === 'show' ? seats.value.filter((x) => !x.ready).map((x) => x.name) : []));

watch(
  () => s.value.hand.join(),
  () => (picked.value = picked.value.filter((c) => s.value.hand.includes(c))),
);
watch(
  () => phase.value,
  () => (picked.value = []),
);

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
async function discard() {
  const reply = await props.send('discard', { cards: picked.value });
  if (reply?.ok) picked.value = [];
}

// An opponent's details (cards held, whether they have discarded, whose crib it is, their pegs) stay hidden until you
// click their chip in the score bar: one at a time, floating at the top of the table, so nothing moves.
const openSeat = ref(null);
const hasDetails = (seat) => others.value.some((o) => o.seat === seat);
const opened = computed(() => others.value.find((o) => o.seat === openSeat.value) ?? null);
const detailLines = (o) => {
  const lines = [`${o.cards} ${o.cards === 1 ? 'card' : 'cards'} in hand`];
  if (phase.value === 'discard') lines.push(o.discarded ? 'Has put cards in the crib' : 'Still choosing cards for the crib');
  lines.push(o.seat === s.value.dealer ? 'The dealer: the crib is theirs' : `Crib: ${cribOwner.value}`);
  lines.push(`Pegs: front on ${o.score}, back on ${o.back}`);
  if (!o.online) lines.push('Away');
  return lines;
};
const closeOnOutside = (event) => {
  if (openSeat.value !== null && !event.target.closest?.('.score-bar .chip-button, .popup')) openSeat.value = null;
};
const closeOnEsc = (event) => event.key === 'Escape' && (openSeat.value = null);
onMounted(() => {
  document.addEventListener('click', closeOnOutside);
  window.addEventListener('keydown', closeOnEsc);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnOutside);
  window.removeEventListener('keydown', closeOnEsc);
});

// ---- the words, all of them in the Status box ----
const status = computed(() => {
  if (finished.value) return `${winner.value.name}${winner.value.seat === me.value ? ' (you)' : ''} wins!`;
  if (phase.value === 'discard') return need.value ? `Choose ${need.value} card${need.value === 1 ? '' : 's'} for ${cribOwner.value} crib.` : `Waiting for ${waitingFor.value.join(', ')}…`;
  if (inPlay.value) return myTurn.value ? (playable.value.size ? 'Your turn: choose a card.' : 'Your turn.') : `${seats.value[turn.value].name} to play.`;
  if (phase.value === 'show') return you.value.ready ? `Waiting for ${waitingForReady.value.join(', ')}…` : 'Close the scores pop-up when you are ready for the next hand.';
  return '';
});
const mine = computed(() => !finished.value && ((phase.value === 'discard' && Boolean(need.value)) || (inPlay.value && myTurn.value)));
const statusLines = computed(() => {
  const lines = [];
  if (phase.value === 'discard' && need.value) lines.push({ text: `${picked.value.length} of ${need.value} chosen: pick them, then press Send to the crib.`, tone: 'muted' });
  if (inPlay.value) {
    const { sequence, previous } = s.value.play;
    if (!sequence.length) lines.push({ text: previous.length ? 'The count has started again at 0.' : 'Nothing has been played yet.', tone: 'muted' });
  }
  if (finished.value) {
    for (const x of standings.value) lines.push({ text: `${x.place}. ${x.name}${x.seat === me.value ? ' (you)' : ''}: ${x.score}`, tone: x.place === 1 ? 'mine' : '' });
    if (skunked.value.length) lines.push({ text: `Skunk! ${skunked.value.map((x) => x.name).join(' and ')} finished below ${s.value.skunkLine}.`, tone: 'muted' });
    lines.push({ text: s.value.isHost ? 'You can start another game.' : 'The host can start another game.', tone: 'muted' });
  }
  return lines;
});

// ---- fitting the room: the cards are sized from the height the frame gives the table ----
const dims = (area) => {
  const hand = Math.round(Math.max(52, Math.min(124, (area.height * 0.34) / 1.4))); // width of a card in your hand, px
  const peg = Math.round(hand * 0.8); // width of a card in the pegging row
  const pile = Math.round(Math.max(40, Math.min(64, area.height * 0.12))); // width of a card in the deck, starter and crib
  const pilesHeight = Math.round(pile * 1.4 + 14 + 20);
  return { hand, peg, pile, pilesHeight, boardHeight: Math.max(120, area.height - pilesHeight - 8) };
};
const sequence = computed(() => (inPlay.value ? s.value.play.sequence : []));
const previous = computed(() => (inPlay.value && !sequence.value.length ? s.value.play.previous : []));
</script>

<template>
  <GameFrame class="table-view">
    <template #scorebar>
      <ScoreBoard ref="scoreboard" :players="scorePlayers" :rounds="state.scoreboard.rounds" :target="state.target" :finished="finished" :awaiting="phase === 'show' && !you.ready" :waiting="waitingForReady" :sticky="false" :has-details="hasDetails" :open-details="openSeat" running @details="(seat) => (openSeat = seat)" @continue="send('ready')">
        <template #round>
          <ShowHands v-if="state.show" :state="state" class="in-modal" />
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <div class="arena">
        <div v-if="opened" class="popup" role="group" :aria-label="`${opened.name}'s details`">
          <h4>
            <span class="chip" :style="{ background: seatColour(opened.seat) }" />
            {{ opened.name }}
            <span v-if="opened.seat === state.dealer" class="badge" title="Dealer">D</span>
          </h4>
          <p v-for="line in detailLines(opened)" :key="line">{{ line }}</p>
        </div>
        <div class="mine-col" :style="{ gridColumn: `span ${area.mainSpan}` }">
          <section class="zone" aria-label="The play">
            <template v-if="inPlay">
              <div class="count" aria-label="The count">
                <span class="muted">Count</span>
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
              <button class="primary" :disabled="picked.length !== need" @click="discard">Send to the crib</button>
            </div>
          </section>

          <section class="hand-area" :style="{ '--w': `${dims(area).hand}px` }">
            <div class="hand" aria-label="Your hand">
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
            <div class="pile" aria-label="The deck">
              <div class="slot-box"><PlayingCard :card="null" size="sm" /></div>
              <small class="muted">Deck</small>
            </div>
            <div class="pile" aria-label="The starter">
              <div class="slot-box">
                <PlayingCard v-if="state.starter" :card="state.starter" size="sm" />
                <PlayingCard v-else :card="null" size="sm" class="faded" />
              </div>
              <small class="muted">Starter</small>
            </div>
            <div class="pile" aria-label="The crib">
              <div class="slot-box crib">
                <PlayingCard v-for="n in Math.max(state.cribCount, 1)" :key="n" :card="null" size="sm" :class="{ faded: !state.cribCount }" />
              </div>
              <small class="muted">Crib</small>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="state.log" newest-first label="Scoring" empty="Nothing scored yet this hand." v-slot="{ entry }">
        <span class="entry"><span class="dot" :style="{ background: seatColour(entry.seat) }" />{{ entry.text }}</span>
      </GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="mine" :lines="statusLines">
        <template #facts>
          <strong>Hand {{ state.handNo }}</strong>
          <span class="dealer"><span class="badge" title="Dealer">D</span>{{ youDeal ? 'You deal' : `${dealer.name} deals` }}</span>
          <span>First to {{ state.target }}</span>
          <span>Deck: {{ state.deckCount }}</span>
          <span>{{ youDeal ? 'Your' : `${dealer.name}'s` }} crib: {{ state.cribCount }}</span>
        </template>
        <div v-if="finished" class="row">
          <button v-if="state.isHost" class="primary" @click="send('rematch')">Play again (back to the lobby)</button>
          <button @click="scoreboard.show()">See the scores</button>
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
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Your side: the pegging row fills what the hand leaves, and the hand sits at the bottom, the most prominent thing. */
.zone {
  flex: 1;
  min-height: 0;
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

/* An opponent's details, opened from their chip in the score bar, float over the top middle of the table. */
.popup {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  min-width: 17rem;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--amber);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-sunken) 96%, transparent);
  filter: drop-shadow(0 6px 18px rgb(0 0 0 / 0.55));
}
.popup h4 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.3rem;
  font-family: var(--display);
}
.popup p {
  margin: 0;
  font-size: 0.9rem;
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
