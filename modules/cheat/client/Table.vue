<script setup>
// The card table for Cheat, in the standard GameFrame: the score bar on top (the score is the cards each player still
// holds); the table (the other seats' face-down hands at the edges, the pile and the rank to claim in the middle, your
// hand along the bottom); and the Recent moves and Status boxes. Every word about what is happening is in Status. The
// table is drawn at one design size and scaled by the window, so nothing changes size or position during a game.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import OpponentHands from '../../../src/components/OpponentHands.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { rankWord } from './rank.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] }, // Recent moves: [{ text }], kept by the page (see log.js)
});

const MAX_SHOWN = 13; // the most cards drawn in an opponent's fan, however many they hold

const board = ref(null);
const picks = ref([]);
const message = ref('');
const sending = ref(false);

const s = computed(() => props.state);
const count = computed(() => s.value.seatCount);
const nameOf = (seat) => s.value.seats[seat]?.name ?? '';
const you = computed(() => s.value.you);
const finished = computed(() => s.value.phase === 'finished');
const checking = computed(() => s.value.phase === 'check');
const isHost = computed(() => s.value.hostSeat === s.value.you);
const myTurn = computed(() => Boolean(s.value.canPlay));
const maxPlay = computed(() => s.value.limits.maxPlay);
const rank = computed(() => s.value.rank);
const mustRespond = computed(() => Boolean(s.value.mustRespond));
const canCall = computed(() => Boolean(s.value.canCall));

const opponents = computed(() =>
  Array.from({ length: count.value - 1 }, (_, i) => i + 1).map((rel) => {
    const seat = (s.value.you + rel) % count.value;
    const other = s.value.seats[seat];
    return { key: seat, name: other.name, cards: Math.min(other.cards, MAX_SHOWN), note: `${other.cards} ${other.cards === 1 ? 'card' : 'cards'}`, away: !other.online, current: s.value.turn === seat };
  }),
);

const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostSeat,
  isHost: () => isHost.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
const opened = computed(() => s.value.seats.find((x) => x && x.seat === openId.value) ?? null);

// ---- the words, all of them in the Status box ----
const claimText = computed(() => rankWord(rank.value, 2));
const status = computed(() => {
  if (finished.value) return `${nameOf(s.value.winner)} gets rid of every card and wins.`;
  if (checking.value) {
    const who = nameOf(s.value.last.seat);
    return mustRespond.value ? `${who} has played their last cards. Call Cheat, or say you believe them.` : s.value.last.seat === you.value ? 'That was your last play: waiting for the others to accept it.' : `Waiting for the others to decide about ${who}'s last play.`;
  }
  if (myTurn.value) return `Your turn: play 1 to ${maxPlay.value} cards and claim ${rankWord(rank.value, 2)}.`;
  return s.value.turn === null ? '' : `Waiting for ${nameOf(s.value.turn)} to play ${rankWord(rank.value, 2)}.`;
});
const mine = computed(() => !finished.value && (myTurn.value || mustRespond.value));
const callMessage = computed(() => {
  const call = s.value.lastCall;
  if (!call) return '';
  return `${nameOf(call.caller)} called Cheat on ${nameOf(call.accused)}: it was ${call.lie ? 'a lie' : 'true'}, so ${nameOf(call.picker)} picked up ${call.pileSize} ${call.pileSize === 1 ? 'card' : 'cards'}.`;
});
const statusLines = computed(() => {
  const lines = [];
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  if (myTurn.value) lines.push({ text: picks.value.length ? `Playing ${picks.value.length} ${picks.value.length === 1 ? 'card' : 'cards'} as ${claimText.value}.` : 'Click the cards to play, then press the button on the table. They need not really be the rank you claim.', tone: 'muted' });
  if (callMessage.value) lines.push({ text: callMessage.value, tone: 'muted' });
  if (finished.value) lines.push({ text: isHost.value ? 'You can start another game.' : 'The host can start another game.', tone: 'muted' });
  return lines;
});

watch(
  () => `${s.value.phase}:${s.value.plays}`,
  () => {
    picks.value = [];
    message.value = '';
  },
);
// Cards that have left your hand (a pick-up adds cards, so keep only the picks you still hold).
watch(
  () => s.value.hand,
  (hand) => (picks.value = picks.value.filter((card) => hand.includes(card))),
);

// A hand can hold two copies of a card (two packs), so a card is picked by position among equal ones.
const chosen = (card, index) => {
  const copies = s.value.hand.slice(0, index + 1).filter((c) => c === card).length;
  return picks.value.filter((c) => c === card).length >= copies;
};
function pickAt(card, index) {
  if (!myTurn.value) return;
  message.value = '';
  const copies = s.value.hand.slice(0, index + 1).filter((c) => c === card).length;
  const have = picks.value.filter((c) => c === card).length;
  if (have >= copies) {
    // Deselect one copy of it.
    const at = picks.value.lastIndexOf(card);
    picks.value = picks.value.filter((_, i) => i !== at);
  } else if (picks.value.length < maxPlay.value) picks.value = [...picks.value, card];
  else message.value = `You can play at most ${maxPlay.value} cards.`;
}

async function submit(event, payload) {
  if (sending.value) return;
  sending.value = true;
  try {
    const reply = await props.send(event, payload);
    if (reply.ok && event === 'play') picks.value = [];
  } finally {
    sending.value = false;
  }
}

const reveal = computed(() => s.value.lastCall?.cards ?? []);
const lastText = computed(() => (s.value.last ? `${nameOf(s.value.last.seat)} played ${s.value.last.count} ${s.value.last.count === 1 ? 'card' : 'cards'} as ${rankWord(s.value.last.rank, s.value.last.count)}.` : ''));

// ---- fitting the room ----
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
        :finished="finished"
        :round-popups="false"
        :sticky="false"
        v-bind="scoreProps"
      />
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>Cards in hand</dt>
          <dd>{{ opened.cards }}</dd>
          <dt>Lies told</dt>
          <dd>{{ opened.stats?.liesTold ?? 0 }}</dd>
          <dt>Caught lying</dt>
          <dd>{{ opened.stats?.liesCaught ?? 0 }}</dd>
          <dt>Calls (correct)</dt>
          <dd>{{ opened.stats?.callsMade ?? 0 }} ({{ opened.stats?.callsCorrect ?? 0 }})</dd>
        </dl>
      </PlayerPopup>
      <section class="felt" aria-label="The table" :style="{ '--s': scale(area) }">
        <OpponentHands :opponents="opponents" :max="MAX_SHOWN" />

        <div class="middle">
          <div class="claim" aria-label="Rank to claim">
            <span class="muted">{{ finished ? 'Game over' : 'Claim' }}</span>
            <b v-if="rank">{{ rank }}</b>
          </div>
          <div class="pile" :aria-label="`The pile: ${state.pile} cards`">
            <PlayingCard v-if="state.pile" size="md" class="top-card" />
            <span v-else class="empty muted">Empty</span>
            <b v-if="state.pile" class="size">{{ state.pile }}</b>
          </div>
          <div class="shown" aria-label="Cards just turned over">
            <PlayingCard v-for="(card, i) in reveal" :key="i" :card="card" size="sm" />
          </div>
          <p class="note muted">{{ lastText }}</p>
        </div>

        <div class="row actions">
          <button v-if="myTurn" class="primary" :disabled="!picks.length || sending" @click="submit('play', { cards: picks })">Play {{ picks.length || '' }} as {{ rankWord(rank, 2) }}</button>
          <template v-else>
            <button :class="{ hidden: !canCall }" :disabled="sending" @click="submit('call')">Cheat!</button>
            <button :class="{ hidden: !mustRespond }" :disabled="sending" @click="submit('accept')">I believe you</button>
          </template>
        </div>

        <div class="hand" role="group" aria-label="Your hand">
          <PlayingCard v-for="(card, i) in state.hand" :key="`${card}-${i}`" :card="card" size="md" :clickable="myTurn" :selected="chosen(card, i)" @pick="pickAt(card, i)" />
        </div>
      </section>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry.text }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="mine" :popup="false" :lines="statusLines">
        <template #facts>
          <span>Claiming {{ rank ? rankWord(rank, 2) : '' }}</span>
          <span>Pile: {{ state.pile }}</span>
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
.felt {
  grid-column: 1 / -1;
  position: relative;
  height: 100%;
  min-height: 0;
}
.middle {
  position: absolute;
  left: 50%;
  top: calc(var(--s) * 8.6rem);
  width: 16rem;
  margin-left: -8rem;
  transform-origin: 50% 0;
  transform: scale(var(--s));
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem 0.8rem;
  align-items: center;
  justify-items: center;
}
.claim {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.claim b {
  font-family: var(--display);
  font-size: 2.6rem;
  line-height: 1;
  color: var(--amber);
}
.pile {
  position: relative;
  height: 6.2rem;
  display: flex;
  align-items: center;
}
.pile .size {
  position: absolute;
  right: -0.9rem;
  bottom: -0.2rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--bg-raised);
  border: 1px solid var(--line, currentColor);
}
.shown {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.2rem;
  height: 4.2rem; /* reserved, so turning cards over moves nothing */
}
.note {
  grid-column: 1 / -1;
  margin: 0;
  height: 1.4rem;
  font-size: 0.85rem;
  text-align: center;
  white-space: nowrap;
}
.actions {
  position: absolute;
  left: 50%;
  top: calc(var(--s) * 21.4rem);
  transform-origin: 50% 50%;
  transform: translateX(-50%) scale(var(--s));
  z-index: 60;
  white-space: nowrap;
}
.hidden {
  visibility: hidden;
}
.hand {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: min(62rem, calc(100% / var(--s)));
  height: 16rem; /* a fixed box of overlapping rows of cards: it scrolls inside if a pick-up fills more */
  transform-origin: 50% 100%;
  transform: translateX(-50%) scale(var(--s));
  display: flex;
  flex-wrap: wrap;
  align-content: safe flex-end;
  justify-content: center;
  padding: 1.4rem 0.4rem 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.hand > :deep(.playing-card) {
  margin: 0 -1.6rem -2.2rem 0;
}
.hand > :deep(.playing-card.selected) {
  z-index: 2;
}
</style>
