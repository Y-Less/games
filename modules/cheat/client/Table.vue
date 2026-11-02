<script setup>
// The card table for Cheat, in the standard GameFrame: the score bar on top (the score is the cards each player still
// holds); the table (the other seats' face-down hands at the edges, the pile and the rank to claim in the middle, your
// hand along the bottom); and the Recent moves and Status boxes.  Every word about what is happening is in Status.  The
// table is drawn at one design size and scaled by the window, so nothing changes size or position during a game.
//
// Props:
//   state  {Object}    required.  The player's view of the game (phases playing, check, finished).
//   send   {Function}  required. send(action, payload) returns a promise of { ok, error? }.
//   log    {Array}     Recent moves as messages (see log.js and shared/messages.js), kept by the page.
// Emits: none.
// Slots: none (fills GameFrame's scorebar, main, log, and status slots).
// Side effects: sends play, call, accept, again, kick, and removeBot requests; keeps local picks/message/sending state
// (picks and message are cleared when the phase or play count changes, and picks are pruned when the hand changes);
// reads the document's root font size to scale the table.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import OpponentHands from '../../../src/components/OpponentHands.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import { rankMsg } from './rank.js';
import { callMsg, copiesUpTo } from './text.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] }, // Recent moves as messages, kept by the page (see log.js)
});
const { t, text } = useGameText();

// (Cap on the fan size so a huge hand cannot overflow an opponent's seat.)
const MAX_SHOWN = 13; // the most cards drawn in an opponent's fan, however many they hold

// Template ref to the ScoreBoard, so the Status box can open it (`board.show()`).
const board = ref(null);
// The cards the player has picked to play, as card codes (equal cards repeat once per copy).
const picks = ref([]);
// A warning for the Status box (for example the pick limit); cleared on the next action.
const message = ref('');
// True while a request is in flight, so buttons cannot be double-pressed.
const sending = ref(false);

// Shorthand for the view.
const s = computed(() => props.state);
// Number of seats at the table.
const count = computed(() => s.value.seatCount);
// Returns the display name of a seat ('' if gone).
const nameOf = (seat) => s.value.seats[seat]?.name ?? '';
// The viewer's seat index.
const you = computed(() => s.value.you);
// True once the game is over.
const finished = computed(() => s.value.phase === 'finished');
// True while everyone decides whether to accept the last (final-cards) play or call Cheat.
const checking = computed(() => s.value.phase === 'check');
// True when the viewer is the host.
const isHost = computed(() => s.value.hostSeat === s.value.you);
// True when the viewer may play cards now.
const myTurn = computed(() => Boolean(s.value.canPlay));
// The most cards one play may hold.
const maxPlay = computed(() => s.value.limits.maxPlay);
// The rank currently to be claimed.
const rank = computed(() => s.value.rank);
// True when the viewer must call Cheat or accept the last play.
const mustRespond = computed(() => Boolean(s.value.mustRespond));
// True when the viewer may call Cheat on the last play.
const canCall = computed(() => Boolean(s.value.canCall));

// The other seats in turn order after the viewer, in the shape OpponentHands wants (name, fan size, note, away, current).
const opponents = computed(() =>
  Array.from({ length: count.value - 1 }, (_, i) => i + 1).map((rel) => {
    const seat = (s.value.you + rel) % count.value;
    const other = s.value.seats[seat];
    return { key: seat, name: other.name, cards: Math.min(other.cards, MAX_SHOWN), note: t('cards.count', { count: other.cards }, other.cards), away: !other.online, current: s.value.turn === seat };
  }),
);

const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostSeat,
  isHost: () => isHost.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
// The seat record whose pop-up is open, or null.
const opened = computed(() => s.value.seats.find((x) => x && x.seat === openId.value) ?? null);

// ---- the words, all of them in the Status box ----
// Returns the spoken form of a rank ('' when there is none): "an Ace" for one card, "Aces" for more.
const rankText = (rank, count = 2) => (rank ? text(rankMsg(rank, count)) : '');
// The plural spoken form of the rank to claim, for example 'Aces'.
const claimText = computed(() => rankText(rank.value, 2));
// The Status box headline: whose move it is and what they must do.
const status = computed(() => {
  if (finished.value) return t('status.wins', { name: nameOf(s.value.winner) });
  if (checking.value) {
    const who = nameOf(s.value.last.seat);
    if (mustRespond.value) return t('status.lastCards', { name: who });
    return s.value.last.seat === you.value ? t('status.yourLastPlay') : t('status.waitingDecide', { name: who });
  }
  if (myTurn.value) return t('status.yourTurn', { max: maxPlay.value, rank: claimText.value });
  return s.value.turn === null ? '' : t('status.waitingFor', { name: nameOf(s.value.turn), rank: claimText.value });
});
// True when the viewer has something to do (highlights the Status box).
const mine = computed(() => !finished.value && (myTurn.value || mustRespond.value));
// What the last call of Cheat turned up, in the past tense (empty until a call has been made).
const callMessage = computed(() => {
  const call = s.value.lastCall;
  if (!call) return '';
  return text(callMsg(call, nameOf, 'status'));
});
// The extra Status lines, each { text, tone }: warning, play hint, last call, and the restart note.
const statusLines = computed(() => {
  const lines = [];
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  if (myTurn.value) lines.push({ text: picks.value.length ? t('status.playing', { count: picks.value.length, rank: claimText.value }, picks.value.length) : t('status.pick'), tone: 'muted' });
  if (callMessage.value) lines.push({ text: callMessage.value, tone: 'muted' });
  if (finished.value) lines.push({ text: isHost.value ? t('status.hostAgain') : t('status.againHost'), tone: 'muted' });
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
/**
 * Says whether the copy of `card` at this position in the hand is one of the picked cards.
 * @param {string} card  The card code.
 * @param {number} index  Its position in the hand.
 * @returns {boolean} True if picked.
 * Side effects: none.
 */
const chosen = (card, index) => {
  const copies = copiesUpTo(s.value.hand, card, index);
  return picks.value.filter((c) => c === card).length >= copies;
};
/**
 * Picks or unpicks the copy of `card` at this position (your turn only), keeping to the most cards one play may hold.
 * @param {string} card  The card code.
 * @param {number} index  Its position in the hand.
 * @returns {void}
 * Side effects: mutates `picks` and `message`.
 */
function pickAt(card, index) {
  if (!myTurn.value) return;
  message.value = '';
  const copies = copiesUpTo(s.value.hand, card, index);
  const have = picks.value.filter((c) => c === card).length;
  if (have >= copies) {
    // Deselect one copy of it.
    const at = picks.value.lastIndexOf(card);
    picks.value = picks.value.filter((_, i) => i !== at);
  } else if (picks.value.length < maxPlay.value) picks.value = [...picks.value, card];
  else message.value = t('status.atMost', { max: maxPlay.value });
}

/**
 * Sends a table action (play, call, or accept) unless one is already in flight.
 * @param {string} event  The request name.
 * @param {Object} [payload]  Request data (the picked cards for 'play').
 * @returns {Promise<void>}
 * Side effects: sends the request; toggles `sending`; clears `picks` after a successful play.
 */
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

// The cards turned over by the last call of Cheat (empty if none).
const reveal = computed(() => s.value.lastCall?.cards ?? []);
// A sentence describing the last play ('' before any play).
const lastText = computed(() => (s.value.last ? t('table.lastPlay', { name: nameOf(s.value.last.seat), count: s.value.last.count, rank: rankText(s.value.last.rank, s.value.last.count) }, s.value.last.count) : ''));

// ---- fitting the room ----
const DESIGN_H = 34; // the height, in rem, the table is designed at
// Returns the root font size in pixels (16 if it cannot be read).
const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
// Returns the scale factor (0.55 to 1.4) that fits the design-size table into the frame's height.
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
          <dt>{{ t('popup.cardsInHand') }}</dt>
          <dd>{{ opened.cards }}</dd>
          <dt>{{ t('popup.liesTold') }}</dt>
          <dd>{{ opened.stats?.liesTold ?? 0 }}</dd>
          <dt>{{ t('popup.caughtLying') }}</dt>
          <dd>{{ opened.stats?.liesCaught ?? 0 }}</dd>
          <dt>{{ t('popup.calls') }}</dt>
          <dd>{{ t('popup.callsValue', { made: opened.stats?.callsMade ?? 0, correct: opened.stats?.callsCorrect ?? 0 }) }}</dd>
        </dl>
      </PlayerPopup>
      <section class="felt" :aria-label="t('table.label')" :style="{ '--s': scale(area) }">
        <OpponentHands :opponents="opponents" :max="MAX_SHOWN" />

        <div class="middle">
          <div class="claim" :aria-label="t('table.rankToClaim')">
            <span class="muted">{{ finished ? t('table.gameOver') : t('table.claim') }}</span>
            <b v-if="rank">{{ rank }}</b>
          </div>
          <div class="pile" :aria-label="t('table.pile', { count: state.pile }, state.pile)">
            <PlayingCard v-if="state.pile" size="md" class="top-card" />
            <span v-else class="empty muted">{{ t('table.empty') }}</span>
            <b v-if="state.pile" class="size">{{ state.pile }}</b>
          </div>
          <div class="shown" :aria-label="t('table.turnedOver')">
            <PlayingCard v-for="(card, i) in reveal" :key="i" :card="card" size="sm" />
          </div>
          <p class="note muted">{{ lastText }}</p>
        </div>

        <div class="row actions">
          <button v-if="myTurn" class="primary" :disabled="!picks.length || sending" @click="submit('play', { cards: picks })">{{ t('table.play', { count: picks.length, rank: claimText }, picks.length) }}</button>
          <template v-else>
            <button :class="{ hidden: !canCall }" :disabled="sending" @click="submit('call')">{{ t('table.cheat') }}</button>
            <button :class="{ hidden: !mustRespond }" :disabled="sending" @click="submit('accept')">{{ t('table.believe') }}</button>
          </template>
        </div>

        <div class="hand" role="group" :aria-label="t('table.yourHand')">
          <PlayingCard v-for="(card, i) in state.hand" :key="`${card}-${i}`" :card="card" size="md" :clickable="myTurn" :selected="chosen(card, i)" @pick="pickAt(card, i)" />
        </div>
      </section>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingPlayed')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="mine" :popup="false" :lines="statusLines">
        <template #facts>
          <span>{{ t('facts.claiming', { rank: claimText }) }}</span>
          <span>{{ t('facts.pile', { n: state.pile }) }}</span>
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
