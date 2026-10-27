<script setup>
// The card table, in the standard GameFrame: the score bar on top; the table itself (the other three seats' face-down
// fans at the edges, the trick in the middle, your hand fanned at the bottom); and the two boxes along the bottom, Recent
// moves and Status. Every word about what is happening (turns, instructions, hand and trick numbers, the target, the
// passing direction) is in Status, so the table holds only cards, names and scores. The table is drawn at one design size
// and scaled by the window (see `scale`), so nothing changes size or position while a game is played.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import CardFan from '../../../src/components/CardFan.vue';
import TrickCircle from '../../../src/components/TrickCircle.vue';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] }, // Recent moves: [{ text }], kept by the page (see log.js)
});

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
// The cards you received are marked only until the first card of the hand is played.
const showReceived = computed(() => playing.value && s.value.trickNumber === 1 && !s.value.trick.length);
const myTurn = computed(() => Boolean(s.value.legal));
const circleSeats = computed(() => [0, 1, 2, 3].map((rel) => ({ key: seatIndex(rel), name: nameOf(seatIndex(rel)) })));
const circlePlays = computed(() => (playing.value ? s.value.trick.map((p) => ({ key: p.seat, card: p.card })) : []));
const oppNote = (rel) => {
  const seat = seatAt(rel);
  if (passing.value) return seat.passed ? 'passed' : 'choosing';
  return seat.tricks ? `${seat.tricks} ${seat.tricks === 1 ? 'trick' : 'tricks'}` : '';
};
const isMoonRound = computed(() => s.value.lastHand?.moon != null);
const you = computed(() => s.value.seats[s.value.you]);
const waitingFor = computed(() => (handEnd.value ? s.value.seats.filter((seat) => !seat.ready).map((seat) => seat.name) : []));
const winnerNames = computed(() => (s.value.winners ?? []).map(nameOf));
const isHost = computed(() => s.value.hostSeat === s.value.you);

// Another player's details open from their chip in the score bar (the standard player pop-up, which also has the
// host's Remove button).
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostSeat,
  isHost: () => isHost.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
const opened = computed(() => s.value.seats.find((x) => x && x.seat === openId.value) ?? null);

const direction = computed(() => {
  const { direction: d, to } = s.value.pass;
  return { left: `to the left (${nameOf(to)})`, right: `to the right (${nameOf(to)})`, across: `across the table (${nameOf(to)})` }[d] ?? '';
});
const passFact = computed(() => ({ left: 'Passing to the left', right: 'Passing to the right', across: 'Passing across', none: 'No passing this hand' })[s.value.pass.direction] ?? '');

// ---- the words, all of them in the Status box ----
const status = computed(() => {
  if (finished.value) return winnerNames.value.length > 1 ? `It is a tie: ${winnerNames.value.join(' and ')} win.` : `${winnerNames.value[0]} wins with ${s.value.scoreboard.players[s.value.winners[0]].score} points.`;
  if (passing.value) return s.value.pass.chosen ? 'Waiting for the others to choose their cards.' : `Choose 3 cards to pass ${direction.value}.`;
  if (playing.value) {
    if (s.value.trickWinner !== null) return `${nameOf(s.value.trickWinner)} takes the trick.`;
    if (myTurn.value) return s.value.trickNumber === 1 && !s.value.trick.length ? 'You have the 2 of clubs: lead it.' : 'Your turn: play a card.';
    return s.value.turn === null ? '' : `Waiting for ${nameOf(s.value.turn)}.`;
  }
  if (handEnd.value) return you.value.ready ? `Waiting for ${waitingFor.value.join(', ')} to be ready for the next hand.` : `Hand ${s.value.lastHand?.hand} is over: close the scores to carry on.`;
  return '';
});
const mine = computed(() => !finished.value && (myTurn.value || (passing.value && !s.value.pass.chosen)));
const statusLines = computed(() => {
  const lines = [];
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  if (passing.value && !s.value.pass.chosen) lines.push({ text: `Pick 3 cards, then press the button on the table (${picks.value.length} of 3 chosen).`, tone: 'muted' });
  if (s.value.received.length && showReceived.value) lines.push({ text: 'The cards you received are outlined in green.', tone: 'muted' });
  if (s.value.lastTrick && playing.value && !s.value.trick.length) lines.push({ text: `Last trick: ${nameOf(s.value.lastTrick.winner)} took it.`, tone: 'muted' });
  if (handEnd.value && moonMessage.value) lines.push({ text: moonMessage.value, tone: 'mine' });
  if (finished.value) {
    lines.push({ text: isHost.value ? 'You can start another game.' : 'The host can start another game.', tone: 'muted' });
  }
  return lines;
});
const moonMessage = computed(() => {
  const moon = s.value.lastHand?.moon;
  if (moon == null) return '';
  return s.value.settings.moon === 'self' ? `${nameOf(moon)} shot the moon and scores -26.` : `${nameOf(moon)} shot the moon: everyone else scores +26.`;
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
  if (!s.value.legal || sending.value) return;
  const reason = s.value.legal[card];
  if (reason) message.value = reason;
  else submit('play', { card });
}

// One card goes at a time: until the server has answered, the card just clicked is still drawn in the hand, and a second
// click on it (a double click, say) would only come back as "That card is not in your hand."
const sending = ref(false);
async function submit(event, payload) {
  sending.value = true;
  try {
    await props.send(event, payload);
  } finally {
    sending.value = false;
  }
}

async function confirmPass() {
  const reply = await props.send('pass', { cards: picks.value });
  if (reply.ok) picks.value = [];
}

const interactive = computed(() => (passing.value && !s.value.pass.chosen) || myTurn.value);
const dimmed = (card) => myTurn.value && s.value.legal[card] !== null;
const reasonFor = (card) => (myTurn.value ? s.value.legal[card] ?? '' : '');

// ---- fitting the room ----
// The table is drawn at a design height of DESIGN_H rem and every piece is scaled by one factor worked out from the
// height the frame gives it, so it is the same at every moment of a game and fills the window at any desktop size.
const DESIGN_H = 34;
const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
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
        :finished="finished"
        :awaiting="handEnd && !you.ready"
        :waiting="waitingFor"
        :sticky="false"
        v-bind="scoreProps"
        @continue="send('next')"
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
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>Score</dt>
          <dd>{{ opened.score }}</dd>
          <dt>Cards in hand</dt>
          <dd>{{ opened.cards }}</dd>
          <template v-if="state.phase !== 'passing'">
            <dt>Tricks taken</dt>
            <dd>{{ opened.tricks }}</dd>
            <dt>Hearts taken</dt>
            <dd>{{ opened.hearts }}<template v-if="opened.queen">, Queen of Spades</template><template v-if="state.settings.jackOfDiamonds && opened.jack">, Jack of Diamonds</template></dd>
            <dt>Points this hand</dt>
            <dd>{{ opened.points }}</dd>
          </template>
          <dt v-else>Passing</dt>
          <dd v-if="state.phase === 'passing'">{{ opened.passed ? 'has chosen' : 'still choosing' }}</dd>
        </dl>
      </PlayerPopup>
      <section class="felt" aria-label="The table" :style="{ '--s': scale(area) }">
        <div v-for="rel in [2, 1, 3]" :key="rel" class="opp" :class="[`pos${rel}`, { away: !seatAt(rel).online }]">
          <CardFan class="opp-fan" :items="Array.from({ length: seatAt(rel).cards }, (_, n) => n)" size="sm" :step="4" :reach="6" :flip="rel === 2" :aria-label="`${seatAt(rel).cards} cards`">
            <template #default><PlayingCard :card="null" size="sm" /></template>
          </CardFan>
          <div class="label">
            <strong class="who">{{ seatAt(rel).name }}</strong>
            <span class="tag">{{ oppNote(rel) }}</span>
          </div>
        </div>

        <TrickCircle class="trick" :seats="circleSeats" :plays="circlePlays" :winner-key="state.trickWinner" size="lg" />

        <CardFan class="my-fan hand" :class="{ fanned: area.minimised }" role="group" aria-label="Your hand" :items="state.hand" :item-key="(card) => card" size="lg" :max="13" :straight="!area.minimised">
          <template #default="{ item: card }">
            <div class="slot" :class="{ received: showReceived && state.received.includes(card) }" :title="reasonFor(card)">
              <PlayingCard :card="card" size="lg" :clickable="interactive" :selected="picks.includes(card)" :dimmed="dimmed(card)" @pick="pick" />
            </div>
          </template>
        </CardFan>
        <div class="row confirm" :class="{ hidden: !(passing && !state.pass.chosen) }">
          <button class="primary" :disabled="picks.length !== 3" @click="confirmPass">Pass these {{ picks.length }} of 3 cards</button>
        </div>
      </section>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry.text }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="mine" :lines="statusLines">
        <template #facts>
          <strong>Hand {{ state.handNumber }}</strong>
          <span v-if="playing || handEnd">Trick {{ state.trickNumber }} of 13</span>
          <span v-if="playing || handEnd">{{ state.heartsBroken ? 'Hearts are broken' : 'Hearts not broken yet' }}</span>
          <span v-if="passing">{{ passFact }}</span>
          <span>Play to {{ state.scoreboard.target }}</span>
          <span v-if="state.settings.jackOfDiamonds">Jack of Diamonds: -5</span>
        </template>
        <div v-if="finished" class="row">
          <button v-if="isHost" class="primary" @click="send('again')">Play again</button>
          <button @click="board.show()">See the scores</button>
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
  top: 0;
  left: 50%;
  margin-left: -9.2rem;
  transform-origin: 50% 0;
  transform: scale(var(--s));
}
.pos1 {
  left: 0;
  top: 50%;
  margin-top: -4.9rem;
  transform-origin: 50% 50%;
  transform: translate(calc(var(--s) * 4.9rem - 9.2rem), 0) rotate(90deg) scale(var(--s));
}
.pos3 {
  right: 0;
  top: 50%;
  margin-top: -4.9rem;
  transform-origin: 50% 50%;
  transform: translate(calc(9.2rem - var(--s) * 4.9rem), 0) rotate(-90deg) scale(var(--s));
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
.who {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.05rem;
}
.tag {
  min-height: 1.1rem;
  font-size: 0.8rem;
  color: var(--muted);
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
  margin-left: -19.9rem;
  transform-origin: 50% 100%;
  transform: scale(var(--s));
}
.my-fan.fanned {
  margin-left: -20.3rem; /* the fanned hand is a little wider than the flat row */
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
