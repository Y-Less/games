<script setup>
// The card table: scoreboard, the other three seats, the current trick, your hand and the pass screen.
import { computed, ref, watch } from 'vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import CardFan from '../../../src/components/CardFan.vue';
import TrickCircle from '../../../src/components/TrickCircle.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const board = ref(null);
const picks = ref([]);
const message = ref('');

const s = computed(() => props.state);
const seatAt = (rel) => s.value.seats[(s.value.you + rel) % 4];
const seatIndex = (rel) => (s.value.you + rel) % 4;
const nameOf = (seat) => s.value.seats[seat]?.name ?? '';
const passing = computed(() => s.value.phase === 'passing');
const finished = computed(() => s.value.phase === 'finished');
const handEnd = computed(() => s.value.phase === 'handEnd');
const playing = computed(() => s.value.phase === 'playing');
const myTurn = computed(() => Boolean(s.value.legal));
const circleSeats = computed(() => [0, 1, 2, 3].map((rel) => ({ key: seatIndex(rel), name: nameOf(seatIndex(rel)) })));
const circlePlays = computed(() => (playing.value ? s.value.trick.map((p) => ({ key: p.seat, card: p.card })) : []));
const oppNote = (rel) => {
  const seat = seatAt(rel);
  if (passing.value) return seat.passed ? 'passed' : 'choosing';
  if (seat.bot) return seat.tricks ? `computer · ${seat.tricks} ${seat.tricks === 1 ? 'trick' : 'tricks'}` : 'computer';
  if (!seat.online) return 'away';
  return seat.tricks ? `${seat.tricks} ${seat.tricks === 1 ? 'trick' : 'tricks'}` : '';
};
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

    <section class="felt" aria-label="The table">
      <div v-for="rel in [2, 1, 3]" :key="rel" class="opp" :class="[`pos${rel}`, { turn: state.turn === seatIndex(rel) && playing, away: !seatAt(rel).online }]">
        <CardFan class="opp-fan" :items="Array.from({ length: seatAt(rel).cards }, (_, n) => n)" size="sm" :step="4" :reach="6" :flip="rel === 2" :aria-label="`${seatAt(rel).cards} cards`">
          <template #default><PlayingCard :card="null" size="sm" /></template>
        </CardFan>
        <div class="label">
          <span class="name">{{ seatAt(rel).name }} <span class="dot">&bull;</span> {{ seatAt(rel).points }}</span>
          <span class="tag">{{ oppNote(rel) }}</span>
        </div>
      </div>

      <TrickCircle class="trick" :seats="circleSeats" :plays="circlePlays" :winner-key="state.trickWinner" size="lg">
        <p class="muted">{{ passing ? 'Passing' : '' }}</p>
      </TrickCircle>

      <CardFan class="my-fan hand" role="group" aria-label="Your hand" :items="state.hand" :item-key="(card) => card" size="md" :max="13">
        <template #default="{ item: card }">
          <div class="slot" :class="{ received: state.received.includes(card) }" :title="reasonFor(card)">
            <PlayingCard :card="card" size="md" :clickable="interactive" :selected="picks.includes(card)" :dimmed="dimmed(card)" @pick="pick" />
          </div>
        </template>
      </CardFan>
      <div class="row confirm" :class="{ hidden: !(passing && !state.pass.chosen) }">
        <button class="primary" :disabled="picks.length !== 3" @click="confirmPass">Pass these {{ picks.length }} of 3 cards</button>
      </div>
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
.felt {
  position: relative;
  width: 100%;
  max-width: 60rem;
  height: 37rem;
  margin: 0 auto;
  border-radius: var(--radius);
  background: radial-gradient(ellipse at center, rgb(30 80 60 / 0.55), rgb(14 40 32 / 0.55));
  border: 1px solid var(--line);
  overflow: hidden;
}
.opp {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 18.4rem;
  height: 9.8rem;
  border-radius: 12px;
}
.pos2 {
  top: 0.4rem;
  left: 50%;
  margin-left: -9.2rem;
}
.pos1 {
  left: 0;
  top: 50%;
  margin-top: -4.9rem;
  transform-origin: 50% 50%;
  transform: translate(-4.3rem, 0) rotate(90deg);
}
.pos3 {
  right: 0;
  top: 50%;
  margin-top: -4.9rem;
  transform: translate(4.3rem, 0) rotate(-90deg);
}
.opp.turn .name {
  color: var(--amber);
}
.opp.away {
  opacity: 0.65;
}
.label {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 2.6rem;
  line-height: 1.3;
}
.name {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.dot {
  color: var(--muted);
}
.tag {
  min-height: 1.1rem;
  font-size: 0.72rem;
  color: var(--muted);
}
.trick {
  position: absolute;
  left: 50%;
  top: 10.4rem;
  margin-left: -8.1rem;
}
.my-fan {
  position: absolute;
  left: 50%;
  bottom: 1.4rem;
  margin-left: -15.4rem;
}
.slot {
  width: 100%;
  height: 100%;
  border-radius: 8px;
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
.slot.received :deep(.playing-card) {
  outline: 2px solid var(--moss);
  outline-offset: 1px;
}
.confirm {
  position: absolute;
  left: 50%;
  top: 21.5rem;
  transform: translateX(-50%);
  z-index: 60;
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
</style>
