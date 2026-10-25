<script setup>
// The card table: scoreboard, the other three seats, the current trick, your hand and the pass screen.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import TrickCircle from '../../../src/components/TrickCircle.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const board = ref(null);
const picks = ref([]);
const message = ref('');
const small = ref(false);
const measure = () => (small.value = window.innerWidth < 640);
onMounted(() => {
  measure();
  window.addEventListener('resize', measure);
});
onBeforeUnmount(() => window.removeEventListener('resize', measure));

const s = computed(() => props.state);
const seatAt = (rel) => s.value.seats[(s.value.you + rel) % 4];
const seatIndex = (rel) => (s.value.you + rel) % 4;
const nameOf = (seat) => s.value.seats[seat]?.name ?? '';
const cardSize = computed(() => (small.value ? 'sm' : 'md'));
const passing = computed(() => s.value.phase === 'passing');
const finished = computed(() => s.value.phase === 'finished');
const handEnd = computed(() => s.value.phase === 'handEnd');
const playing = computed(() => s.value.phase === 'playing');
const myTurn = computed(() => Boolean(s.value.legal));
const circleSeats = computed(() => [0, 1, 2, 3].map((rel) => ({ key: seatIndex(rel), name: nameOf(seatIndex(rel)) })));
const circlePlays = computed(() => (playing.value ? s.value.trick.map((p) => ({ key: p.seat, card: p.card })) : []));
const isMoonRound = computed(() => s.value.lastHand?.moon != null);

const direction = computed(() => {
  const { direction: d, to } = s.value.pass;
  return { left: `to the left (${nameOf(to)})`, right: `to the right (${nameOf(to)})`, across: `across the table (${nameOf(to)})` }[d] ?? '';
});
const fromName = computed(() => nameOf(s.value.pass.from));

const status = computed(() => {
  if (passing.value) return s.value.pass.chosen ? 'Waiting for the others to choose their cards.' : `Choose 3 cards to pass ${direction.value}.`;
  if (playing.value) {
    if (s.value.trickWinner !== null) return `${nameOf(s.value.trickWinner)} takes the trick.`;
    if (myTurn.value) return s.value.trickNumber === 1 && !s.value.trick.length ? 'You have the 2 of clubs: lead it.' : 'Your turn: play a card.';
    return s.value.turn === null ? '' : `Waiting for ${nameOf(s.value.turn)}.`;
  }
  if (handEnd.value) return `Hand ${s.value.lastHand?.hand} is over.`;
  return '';
});

watch(
  () => `${s.value.phase}:${s.value.handNumber}`,
  () => (picks.value = []),
);
watch(
  () => `${s.value.turn}:${s.value.trick.length}`,
  () => (message.value = ''),
);

function pick(card) {
  message.value = '';
  if (passing.value && !s.value.pass.chosen) {
    if (picks.value.includes(card)) picks.value = picks.value.filter((c) => c !== card);
    else if (picks.value.length < 3) picks.value = [...picks.value, card];
    return;
  }
  if (!s.value.legal) return;
  const reason = s.value.legal[card];
  if (reason) message.value = reason;
  else props.send('play', { card });
}

async function confirmPass() {
  const reply = await props.send('pass', { cards: picks.value });
  if (reply.ok) picks.value = [];
}

const interactive = computed(() => (passing.value && !s.value.pass.chosen) || myTurn.value);
const dimmed = (card) => myTurn.value && s.value.legal[card] !== null;
const reasonFor = (card) => (myTurn.value ? s.value.legal[card] ?? '' : '');
const winnerNames = computed(() => (s.value.winners ?? []).map(nameOf));
const you = computed(() => s.value.seats[s.value.you]);
const moonMessage = computed(() => {
  const moon = s.value.lastHand?.moon;
  if (moon == null) return '';
  return s.value.settings.moon === 'self' ? `${nameOf(moon)} shot the moon and scores -26.` : `${nameOf(moon)} shot the moon: everyone else scores +26.`;
});
</script>

<template>
  <div class="table-view stack">
    <ScoreBoard
      ref="board"
      :players="state.scoreboard.players"
      :rounds="state.scoreboard.rounds"
      :low-is-better="state.scoreboard.lowIsBetter"
      :target="state.scoreboard.target"
      :finished="finished"
    >
      <template #round>
        <section v-if="state.lastHand && (handEnd || finished)" class="summary stack" aria-label="This hand">
          <p v-if="moonMessage" class="moon" role="status">{{ moonMessage }}</p>
          <ul class="taken">
            <li v-for="(seat, i) in state.seats" :key="i" :class="{ me: i === state.you }">
              <strong>{{ seat.name }}</strong>
              <span class="muted">
                {{ state.lastHand.details[i].hearts }} {{ state.lastHand.details[i].hearts === 1 ? 'heart' : 'hearts' }}<template v-if="state.lastHand.details[i].queen">, Queen of Spades</template><template v-if="state.settings.jackOfDiamonds && state.lastHand.details[i].jack">, Jack of Diamonds</template>
              </span>
              <b>{{ state.lastHand.points[i] > 0 && !isMoonRound ? '+' : '' }}{{ state.lastHand.points[i] }}</b>
            </li>
          </ul>
        </section>
      </template>
    </ScoreBoard>

    <div class="info row">
      <span class="muted">Hand {{ state.handNumber }}<template v-if="playing"> · trick {{ state.trickNumber }} of 13</template></span>
      <span v-if="playing || handEnd" class="muted">{{ state.heartsBroken ? 'Hearts are broken' : 'Hearts not broken yet' }}</span>
      <span v-if="state.settings.jackOfDiamonds" class="muted">Jack of Diamonds: -5</span>
    </div>

    <section class="table" aria-label="The table">
      <div v-for="rel in [2, 1, 3]" :key="rel" class="seat" :class="[`pos${rel}`, { turn: state.turn === seatIndex(rel) && playing, away: !seatAt(rel).online }]">
        <span class="name">{{ seatAt(rel).name }}</span>
        <span class="tag" :class="{ hidden: !seatAt(rel).bot && seatAt(rel).online }">{{ seatAt(rel).bot ? 'computer' : 'away' }}</span>
        <div class="stack-of-cards" :aria-label="`${seatAt(rel).cards} cards`">
          <PlayingCard :card="null" size="sm" />
          <b class="count">{{ seatAt(rel).cards }}</b>
        </div>
        <span class="pts">{{ seatAt(rel).points }} pts<template v-if="seatAt(rel).tricks"> · {{ seatAt(rel).tricks }} {{ seatAt(rel).tricks === 1 ? 'trick' : 'tricks' }}</template></span>
        <span class="tag" :class="{ hidden: !passing }">{{ seatAt(rel).passed ? 'passed' : 'choosing' }}</span>
      </div>

      <TrickCircle class="centre" :seats="circleSeats" :plays="circlePlays" :winner-key="state.trickWinner" :size="cardSize">
        <p class="muted">{{ passing ? 'Passing' : '' }}</p>
      </TrickCircle>
    </section>

    <p class="status" :class="{ mine: myTurn || (passing && !state.pass.chosen) }" role="status">{{ status }}</p>
    <div class="notes">
      <p class="muted small-note">{{ state.lastTrick && playing && !state.trick.length ? `Last trick: ${nameOf(state.lastTrick.winner)} took it.` : '' }}</p>
      <p class="reason" role="alert">{{ message }}</p>
    </div>

    <section class="mine-area">
      <div class="row mine-head">
        <strong>{{ you.name }}</strong><span class="muted">(you)</span>
        <span class="muted">{{ you.points }} pts this hand</span>
        <button class="quiet leave" :class="{ hidden: !playing }" :disabled="!playing" @click="send('leave')">Leave game</button>
      </div>
      <div class="hand" role="group" aria-label="Your hand">
        <div v-for="card in state.hand" :key="card" class="slot" :class="{ received: state.received.includes(card) }" :title="reasonFor(card)">
          <PlayingCard
            :card="card"
            :size="cardSize"
            :clickable="interactive"
            :selected="picks.includes(card)"
            :dimmed="dimmed(card)"
            @pick="pick"
          />
        </div>
      </div>
      <div class="row confirm" :class="{ hidden: !(passing && !state.pass.chosen) }">
        <button class="primary" :disabled="picks.length !== 3" @click="confirmPass">Pass these {{ picks.length }} of 3 cards</button>
      </div>
      <p class="muted small-note">{{ state.received.length && state.phase === 'playing' ? 'Cards you received are marked.' : '' }}</p>
    </section>

    <!-- These come after the hand so that they never push it about. -->
    <section v-if="passing && state.pass.chosen" class="panel passed">
      <div>
        <p class="muted">You passed {{ direction }}</p>
        <div class="row cards">
          <PlayingCard v-for="c in state.pass.chosen" :key="c" :card="c" size="sm" />
        </div>
      </div>
      <div>
        <p class="muted">{{ state.pass.incomingReady ? `${fromName} has passed you three cards` : `Waiting for ${fromName} to pass` }}</p>
        <div class="row cards">
          <template v-if="state.pass.incomingReady"><PlayingCard v-for="n in 3" :key="n" :card="null" size="sm" /></template>
          <span v-else v-for="n in 3" :key="n" class="ghost" />
        </div>
      </div>
    </section>

    <section v-if="handEnd" class="panel stack">
      <h3>Hand {{ state.lastHand?.hand }} is over</h3>
      <p v-if="moonMessage" class="moon">{{ moonMessage }}</p>
      <div class="row">
        <button class="primary" @click="send('next')">Deal the next hand</button>
        <button @click="board.show()">See the scores</button>
        <button class="quiet" @click="send('leave')">Leave game</button>
      </div>
    </section>

    <section v-if="finished" class="panel stack">
      <h3>{{ winnerNames.length > 1 ? 'It is a tie' : 'We have a winner' }}</h3>
      <p class="winner">{{ winnerNames.join(' and ') }} {{ winnerNames.length > 1 ? 'win' : 'wins' }} with {{ state.scoreboard.players[state.winners[0]].score }} points.</p>
      <div class="row">
        <button v-if="state.hostSeat === state.you" class="primary" @click="send('again')">Play again</button>
        <span v-else class="muted">The host can start another game.</span>
        <button @click="board.show()">See the scores</button>
        <button class="quiet" @click="send('leave')">Leave game</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.info {
  justify-content: space-between;
  font-size: 0.9rem;
}
.table {
  display: grid;
  grid-template-columns: minmax(4.6rem, 1fr) minmax(0, 2.4fr) minmax(4.6rem, 1fr);
  grid-template-areas: '. top .' 'left centre right';
  gap: 0.6rem;
  align-items: center;
  padding: 0.8rem 0.4rem;
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  border-radius: var(--radius);
  background: radial-gradient(ellipse at center, rgb(30 80 60 / 0.55), rgb(14 40 32 / 0.55));
  border: 1px solid var(--line);
}
.seat {
  width: 10rem;
  max-width: 100%;
  justify-self: center;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.4rem 0.3rem;
  border-radius: 12px;
  border: 2px solid transparent;
  text-align: center;
  min-width: 0;
}
.seat.turn {
  border-color: var(--amber);
  background: rgb(224 168 74 / 0.12);
}
.seat.away {
  opacity: 0.65;
}
.pos2 {
  grid-area: top;
  justify-self: center;
}
.pos1 {
  grid-area: left;
}
.pos3 {
  grid-area: right;
}
.name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.tag {
  min-height: 1.1rem;
  font-size: 0.7rem;
  padding: 0 0.45rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
}
.stack-of-cards {
  position: relative;
}
.count {
  position: absolute;
  right: -0.5rem;
  bottom: -0.3rem;
  min-width: 1.5rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--bg-raised);
  border: 1px solid var(--line);
  font-size: 0.8rem;
  text-align: center;
}
.pts {
  min-height: 1.1rem;
  font-size: 0.78rem;
  color: var(--muted);
}
.centre {
  grid-area: centre;
  justify-self: center;
}
.hidden {
  visibility: hidden;
}
.notes {
  display: grid;
  min-height: 3.2rem;
  align-content: start;
}
.status {
  margin: 0;
  text-align: center;
  min-height: 1.5rem;
  color: var(--muted);
}
.status.mine {
  color: var(--amber);
  font-weight: 600;
}
.reason {
  margin: 0;
  min-height: 1.5rem;
  text-align: center;
  color: var(--danger);
}
.small-note {
  margin: 0;
  min-height: 1.3rem;
  text-align: center;
  font-size: 0.85rem;
}
.passed {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 2rem;
  justify-content: center;
}
.passed p {
  margin: 0 0 0.4rem;
}
.cards {
  gap: 0.4rem;
}
.ghost {
  width: 3rem;
  aspect-ratio: 5 / 7;
  border: 2px dashed var(--line);
  border-radius: 6px;
}
.mine-head {
  gap: 0.4rem;
  margin-bottom: 0.2rem;
}
.leave {
  margin-left: auto;
}
.hand {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem 0;
  padding: 0.9rem 0.8rem 0.3rem;
  min-height: 7.6rem; /* a full row of cards, so the hand never shrinks as cards are played */
}
.slot {
  position: relative;
  margin: 0 -0.95rem;
  border-radius: 8px;
}
.slot:has(.selected),
.slot:hover {
  z-index: 2;
}
.slot.received :deep(.playing-card) {
  outline: 2px solid var(--moss);
  outline-offset: 1px;
}
.confirm {
  justify-content: center;
  margin-top: 0.4rem;
}
.moon {
  margin: 0;
  color: var(--amber);
  font-family: var(--display);
  font-size: 1.1rem;
}
.winner {
  margin: 0;
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
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
@media (max-width: 640px) {
  .slot {
    margin: 0 -0.55rem;
  }
}
</style>
