<script setup>
// The Zurubang table, in the standard GameFrame: the score bar on top; the battlefield in the middle with your hand
// below it; the other player's hand of backs, the stacks, and the graveyard down the right-hand side; and the two
// boxes along the bottom, Recent moves and Status.  Everything about what is happening — whose turn it is, what the
// duel stands at, which position the next card goes on — is in Status, and nothing on the table changes size from one
// phase to the next.
//
// The one thing to keep in mind reading this: in Zurubang the backs are public and the faces are private, so every
// place on the table always holds a card-shaped thing.  A card you may not see is its own back, not a gap.
//
// Props:
//   state  {Object}    required.  The player's view of the game.
//   send   {Function}  required.  send(action, payload) asks the server to do something.
// Emits: none.  Slots: none (it fills GameFrame's slots).
// Side effects: sends swapOne, swapAll, challenge, answer, starter, place, reveal, sudden, ready, and the removals;
//   keeps the card picked out of your hand and the stack you last chose.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayAgain from '../../../src/components/PlayAgain.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import CardImage from './CardImage.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t, text, list } = useGameText();

/** The card picked out of your hand, which a swap then changes. */
const picked = ref(null);
/** The stack you last chose to draw from, or null to let the server take the fullest. */
const stack = ref(null);

const s = computed(() => props.state);
const me = computed(() => s.value.you);
const them = computed(() => (me.value === 0 ? 1 : 0));
const phase = computed(() => s.value.phase);
const duel = computed(() => s.value.duel);
const finished = computed(() => phase.value === 'finished');
const mySeat = computed(() => s.value.seats[me.value] ?? null);
const theirSeat = computed(() => s.value.seats[them.value] ?? null);
/** The five positions, counted from the stacks, which is how everything in the rules is numbered. */
const POSITIONS = [0, 1, 2, 3, 4];
/**
 * A hand drawn as five places rather than as however many cards are in it.  A duel empties a hand a card at a time,
 * and a row that closed up behind each one would slide the whole table sideways five times a duel; an empty place
 * where a card was is both calmer and truer to what is in front of you.
 */
const slotsOf = (cards) => POSITIONS.map((i) => cards[i] ?? null);
const myHand = computed(() => slotsOf(s.value.hand).map((card) => (card ? { id: card, back: null } : null)));
const theirHand = computed(() => slotsOf(s.value.theirHand));

// A hand that changes under a picked card leaves nothing picked, and so does a change of phase.
watch(
  () => [s.value.hand.join(','), phase.value],
  () => {
    if (!s.value.hand.includes(picked.value)) picked.value = null;
  },
);

/** Is it this player's move at all?  Every button below is drawn from this and the phase. */
const mine = computed(() => {
  if (me.value === -1) return false;
  if (phase.value === 'turn') return s.value.turn === me.value;
  if (phase.value === 'challenged' || phase.value === 'starter') return duel.value?.challenger !== me.value;
  if (phase.value === 'placing') return s.value.placer?.seat === me.value;
  if (phase.value === 'sudden') return duel.value?.sudden?.picked === null;
  if (phase.value === 'duelOver') return !mySeat.value?.ready;
  return false;
});

/** The position your next card goes on, which the rhythm of the duel decides rather than you. */
const nextPosition = computed(() => (phase.value === 'placing' && s.value.placer?.seat === me.value ? s.value.placer.position : null));

/** A battlefield place, from the point of view of whoever is looking. */
const placeAt = (side, position) => duel.value?.placed?.[side]?.[position] ?? null;
/** Which positions of yours are still in a sudden death. */
const suddenOut = computed(() => new Set(duel.value?.sudden?.out ?? []));
/** The pair being fought right now, for the glow on the table. */
const fighting = computed(() => (phase.value === 'revealing' && duel.value ? duel.value.at : -1));

/** The gap between two cards. */
const GAP = 8;
/**
 * How wide to draw a card so that all four rows of five — their hand, their side, your side, your hand — fit the room
 * the frame gives the table, at every window the game can be played in.
 *
 * The frame hands its slots the width of the whole row in `width` and the width of each part in `left` and `right`,
 * so a game that sizes anything off `width` draws it too wide and lets it off the side of the table.  This one asks
 * for every column, so `left` is the lot.
 */
const cardWidth = (area) => Math.max(34, Math.round(Math.min((area.left - 6 * GAP) / 5, ((area.height - 56) * 3) / 20)));
/** A card's height at that width: the art is 3:5.  A row of no cards keeps it, so that nothing on the table moves. */
const cardHeight = (area) => Math.round((cardWidth(area) * 5) / 3);

/** The scoreboard's players, straight from the server, plus the pop-up's wiring. */
const scorePlayers = computed(() => s.value.scoreboard.players);
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => scorePlayers.value,
  hostId: () => s.value.seats.find((seat) => seat?.host)?.seat ?? null,
  isHost: () => Boolean(s.value.isHost),
  send: props.send,
  vote: () => s.value.vote ?? null,
});
/** The seat whose details are open, or null. */
const opened = computed(() => (openId.value === null ? null : (s.value.seats.find((seat) => seat?.seat === openId.value) ?? null)));

/** The names of anybody still to close a duel's result. */
const waitingForReady = computed(() => (phase.value === 'duelOver' ? s.value.seats.filter((seat) => seat && !seat.ready).map((seat) => seat.name) : []));

/** What the status box says is happening, in one line. */
const headline = computed(() => {
  if (finished.value) return s.value.winner === me.value ? t('status.youWon') : t('status.theyWon', { name: s.value.seats[s.value.winner]?.name ?? '' });
  switch (phase.value) {
    case 'turn':
      return mine.value ? t('status.yourTurn') : t('status.theirTurn', { name: theirSeat.value?.name ?? '' });
    case 'challenged':
      return mine.value ? t('status.answerChallenge') : t('status.waitingAnswer', { name: theirSeat.value?.name ?? '' });
    case 'starter':
      return mine.value ? t('status.chooseStarter') : t('status.waitingStarter', { name: theirSeat.value?.name ?? '' });
    case 'placing':
      return mine.value ? t('status.placeOn', { position: (nextPosition.value ?? 0) + 1 }) : t('status.theyPlace', { name: theirSeat.value?.name ?? '' });
    case 'revealing':
      return t('status.revealing', { position: fighting.value + 1 });
    case 'sudden':
      return duel.value?.sudden?.picked === null ? t('status.pickSudden') : t('status.pickedSudden');
    case 'duelOver':
      return duelResult.value;
    default:
      return '';
  }
});

/** How the duel just finished, in the player's own terms. */
const duelResult = computed(() => {
  const result = duel.value?.result;
  if (!result) return '';
  if (result.winner === null) return t('status.duelDrawn');
  const points = result.banked + result.bonus;
  return result.winner === me.value ? t('status.youTook', { points }) : t('status.theyTook', { name: s.value.seats[result.winner]?.name ?? '', points });
});

/** The persistent facts: the score to play to, how many duels have been fought, and the graveyard. */
const facts = computed(() => [
  { label: t('facts.playingTo'), value: String(s.value.target) },
  { label: t('facts.duels'), value: String(s.value.duelNo) },
  { label: t('facts.graveyard'), value: String(s.value.graveyard) },
]);

/** The extra lines under the headline: what a duel stands at, and what each hand of backs is worth. */
const lines = computed(() => {
  const out = [];
  if (duel.value && ['revealing', 'sudden', 'duelOver'].includes(phase.value)) {
    out.push(t('status.points', { mine: duel.value.points[me.value], theirs: duel.value.points[them.value] }));
  }
  if (duel.value?.special?.[me.value]) out.push(t(`status.special.${duel.value.special[me.value]}`));
  if (duel.value?.special?.[them.value]) out.push(t(`status.theirSpecial.${duel.value.special[them.value]}`, { name: theirSeat.value?.name ?? '' }));
  if (phase.value === 'duelOver' && waitingForReady.value.length) out.push(t('status.waitingFor', { names: list(waitingForReady.value) }));
  return out;
});

/** The three stacks, for the row of buttons that says which one a swap draws from. */
const stackButtons = computed(() => s.value.stacks.map((count, i) => ({ index: i, count, label: t('table.stack', { n: i + 1, count }) })));

/** Picking a card out of your hand, or, while the duel is being laid out, putting it straight down. */
function useCard(card) {
  if (phase.value === 'placing' && mine.value) {
    props.send('place', { card });
    picked.value = null;
    return;
  }
  picked.value = picked.value === card ? null : card;
}

/** Choosing one of your own cards in a sudden death. */
function pickSudden(position) {
  if (phase.value !== 'sudden' || !mine.value || suddenOut.value.has(position)) return;
  props.send('sudden', { position });
}

/** Swapping the picked card, or the whole hand, for cards off the chosen stack. */
const swapOne = () => picked.value && props.send('swapOne', { card: picked.value, stack: stack.value ?? undefined });
const swapAll = () => props.send('swapAll', { stacks: stack.value === null ? undefined : Array(5).fill(stack.value) });
</script>

<template>
  <GameFrame class="zurubang-table" :main-span="12">
    <template #scorebar>
      <ScoreBoard
        :players="scorePlayers"
        :rounds="state.scoreboard.rounds"
        :target="state.target"
        :finished="finished"
        :awaiting="phase === 'duelOver' && !mySeat?.ready"
        :waiting="waitingForReady"
        :sticky="false"
        :round-popups="false"
        v-bind="scoreProps"
        running
        @continue="phase === 'duelOver' && send('ready')"
      />
    </template>

    <template #main="area">
      <div class="arena" :style="{ gridColumn: `span ${area.mainSpan}` }">
        <PlayerPopup v-if="popupProps" v-bind="popupProps">
          <dl v-if="opened" class="facts">
            <dt>{{ t('popup.cards') }}</dt>
            <dd>{{ opened.cards }}</dd>
            <dt>{{ t('popup.score') }}</dt>
            <dd>{{ opened.score }}</dd>
            <template v-if="opened.ai">
              <dt>{{ t('popup.ai') }}</dt>
              <dd>{{ opened.ai.name }}</dd>
            </template>
          </dl>
        </PlayerPopup>

        <section class="their-hand" :style="{ height: `${cardHeight(area)}px` }" :aria-label="t('table.theirHandTitle', { name: theirSeat?.name ?? '' })">
          <CardImage v-for="(card, i) in theirHand" :key="`t-${i}`" :card="card" :width="cardWidth(area)" />
        </section>

        <section class="battlefield" :aria-label="t('table.battlefield')">
          <div class="row-of-five" :aria-label="t('table.theirSide', { name: theirSeat?.name ?? '' })">
            <CardImage v-for="p in POSITIONS" :key="`them-${p}`" :card="placeAt(them, p)" :width="cardWidth(area)" :highlight="fighting === p" />
          </div>
          <ol class="positions" :aria-label="t('table.positions')">
            <li v-for="p in POSITIONS" :key="`n-${p}`" :style="{ width: `${cardWidth(area)}px` }">{{ p + 1 }}</li>
          </ol>
          <div class="row-of-five" :aria-label="t('table.yourSide')">
            <CardImage
              v-for="p in POSITIONS"
              :key="`me-${p}`"
              :card="placeAt(me, p)"
              :width="cardWidth(area)"
              :highlight="fighting === p"
              :dimmed="suddenOut.has(p)"
              :selected="phase === 'sudden' && duel?.sudden?.picked === p"
              :clickable="phase === 'sudden' && mine && !suddenOut.has(p) && Boolean(placeAt(me, p))"
              @pick="pickSudden(p)"
            />
          </div>
        </section>

        <section class="hand" :style="{ height: `${cardHeight(area)}px` }" :aria-label="t('table.yourHand')">
          <CardImage
            v-for="(card, i) in myHand"
            :key="`m-${i}`"
            :card="card"
            :width="cardWidth(area)"
            :clickable="Boolean(card)"
            :selected="Boolean(card) && picked === card.id"
            @pick="card && useCard(card.id)"
          />
        </section>
      </div>
    </template>

    <template #log>
      <GameLog :entries="state.log" :fresh="6">
        <template #default="{ entry }">{{ text(entry) }}</template>
      </GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mine" :lines="lines">
        <template #facts>
          <span v-for="fact in facts" :key="fact.label" class="fact"><span class="muted">{{ fact.label }}</span> <strong>{{ fact.value }}</strong></span>
          <!-- The stacks are a fact and a choice at once, which keeps the turn's own buttons down to one row. -->
          <span class="fact stacks">
            <span class="muted">{{ t('facts.stacks') }}</span>
            <button
              v-for="button in stackButtons"
              :key="button.index"
              class="quiet pill"
              :class="{ primary: stack === button.index }"
              :aria-pressed="stack === button.index"
              :disabled="!button.count || phase !== 'turn' || !mine"
              @click="stack = stack === button.index ? null : button.index"
            >
              {{ button.label }}
            </button>
          </span>
        </template>

        <div v-if="phase === 'turn' && mine" class="row">
          <button class="primary" :disabled="!picked" @click="swapOne">{{ picked ? t('table.swapOne') : t('table.pickToSwap') }}</button>
          <button @click="swapAll">{{ t('table.swapAll') }}</button>
          <button @click="send('challenge')">{{ t('table.challenge') }}</button>
        </div>

        <div v-else-if="phase === 'challenged' && mine" class="row">
          <button class="primary" @click="send('answer', { accept: true })">{{ t('table.accept') }}</button>
          <button @click="send('answer', { accept: false })">{{ t('table.decline') }}</button>
        </div>

        <div v-else-if="phase === 'starter' && mine" class="row">
          <button class="primary" @click="send('starter', { seat: me })">{{ t('table.iStart') }}</button>
          <button @click="send('starter', { seat: them })">{{ t('table.theyStart', { name: theirSeat?.name ?? '' }) }}</button>
        </div>

        <div v-else-if="phase === 'revealing'" class="row">
          <button class="primary" @click="send('reveal')">{{ t('table.turnOver') }}</button>
        </div>

        <div v-else-if="phase === 'duelOver'" class="row">
          <button class="primary" :disabled="Boolean(mySeat?.ready)" @click="send('ready')">{{ t('table.continue') }}</button>
        </div>

        <PlayAgain :state="{ phase: state.phase, hostId: state.isHost ? state.you : -1, you: state.you }" @again="send('again')" />
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  height: 100%;
}
.battlefield {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.row-of-five {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: nowrap;
}
.positions {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.positions li {
  text-align: center;
  font-size: 0.8rem;
  color: var(--muted, #888);
}
.hand,
.their-hand {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  min-height: 1rem;
}
.fact {
  margin-right: 0.9rem;
  white-space: nowrap;
}
.stacks button.pill {
  margin-left: 0.3rem;
  padding: 0.1rem 0.45rem;
  font-size: 0.85rem;
  line-height: 1.2;
}
.small {
  margin: 0;
  font-size: 0.85rem;
}
</style>
