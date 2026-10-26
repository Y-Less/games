<script setup>
// The table: scoreboard, nobles, the three rows of cards, the gem supply, your actions, every player's board and the log.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { CARD_BY_ID, NOBLE_BY_ID } from '../cards.js';
import CardFace from './CardFace.vue';
import Gem from './Gem.vue';
import { GEM_NAMES } from './gems.js';
import NobleTile from './NobleTile.vue';
import PlayerBoard from './PlayerBoard.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const board = ref(null);
const picks = ref([]); // gem colours chosen for a take action
const sel = ref(null); // { kind: 'card', id } or { kind: 'deck', level }
const message = ref('');
const payGold = ref(null); // how much Gold to pay with, when the player chooses
const giveBack = ref([0, 0, 0, 0, 0, 0]);
const busy = ref(false);

const s = computed(() => props.state);
const finished = computed(() => s.value.phase === 'finished');
const me = computed(() => s.value.seats[s.value.you] ?? null);
const nameOf = (seat) => s.value.seats[seat]?.name ?? 'Someone';
const turnIsMine = computed(() => s.value.phase === 'playing' && s.value.turn === s.value.you);
const pendingMine = computed(() => (s.value.pending && s.value.pending.seat === s.value.you ? s.value.pending : null));
const myTurn = computed(() => turnIsMine.value && !s.value.pending);
const bonuses = computed(() => me.value?.bonuses ?? [0, 0, 0, 0, 0]);
const tokens = computed(() => me.value?.tokens ?? [0, 0, 0, 0, 0, 0]);
const supply = computed(() => s.value.supply);
const needOf = (id) => CARD_BY_ID[id].cost.map((c, i) => Math.max(0, c - bonuses.value[i]));
const sum = (list) => list.reduce((a, b) => a + b, 0);
const seatOrder = computed(() => {
  const n = s.value.seats.length;
  const start = Math.max(0, s.value.you);
  return Array.from({ length: n }, (_, k) => (start + k) % n).filter((i) => s.value.seats[i]);
});

// ---- the banner ----
const banner = computed(() => {
  if (finished.value) return 'The game is over.';
  const pending = s.value.pending;
  if (pending && pending.seat === s.value.you) return pending.type === 'return' ? `You have more than 10 tokens: return ${pending.count}.` : 'Several nobles want to visit you: choose one.';
  if (pending) return `${nameOf(pending.seat)} is ${pending.type === 'return' ? 'returning tokens' : 'choosing a noble'}.`;
  if (myTurn.value) return 'Your turn: take gems, reserve a card or buy a card.';
  return `Waiting for ${nameOf(s.value.turn)}…`;
});
const lastRound = computed(() => (s.value.finalRound && !finished.value ? `${nameOf(s.value.triggeredBy)} reached ${s.value.settings.target}: this is the last round, so everyone gets the same number of turns.` : ''));

// ---- choosing gems ----
const available = computed(() => [0, 1, 2, 3, 4].filter((c) => supply.value[c] > 0));
const isPair = computed(() => picks.value.length === 2 && picks.value[0] === picks.value[1]);
const takeCheck = computed(() => {
  const p = picks.value;
  if (!available.value.length) return { ok: false, text: 'There are no gems left to take. Reserve or buy a card instead.' };
  if (!p.length) return { ok: false, text: 'Click three different gems, or one colour twice for two of a kind.' };
  if (isPair.value) return { ok: true, text: `Take two ${GEM_NAMES[p[0]]} gems.` };
  const need = available.value.length >= 3 ? 3 : 1;
  if (p.length < need) return { ok: false, text: `Pick ${need - p.length} more ${need - p.length === 1 ? 'gem' : 'gems'} of different colours.` };
  const more = Math.min(3, available.value.length) - p.length;
  return { ok: true, text: `Take ${p.map((c) => GEM_NAMES[c]).join(', ')}.${more > 0 ? ` (You could take ${more} more.)` : ''}` };
});

function clickGem(c) {
  message.value = '';
  sel.value = null;
  if (!turnIsMine.value || s.value.pending) {
    message.value = s.value.pending ? 'Finish your current choice first.' : 'It is not your turn.';
    return;
  }
  const p = picks.value;
  if (isPair.value) {
    picks.value = c === p[0] ? [] : [c];
    return;
  }
  if (p.includes(c)) {
    if (p.length === 1 && supply.value[c] >= 4) picks.value = [c, c];
    else if (p.length === 1 && available.value.length > 1) message.value = `To take two ${GEM_NAMES[c]} gems, at least four must be left in the supply.`;
    else picks.value = p.filter((x) => x !== c);
    return;
  }
  if (supply.value[c] < 1) {
    message.value = `There are no ${GEM_NAMES[c]} gems left.`;
    return;
  }
  if (p.length >= 3) {
    message.value = 'You can take at most three gems: click one to put it back first.';
    return;
  }
  picks.value = [...p, c];
}

async function confirmTake() {
  if (!takeCheck.value.ok || busy.value) return;
  busy.value = true;
  const reply = isPair.value ? await props.send('takeTwo', { colour: picks.value[0] }) : await props.send('take', { colours: picks.value });
  busy.value = false;
  if (reply.ok) picks.value = [];
}

// ---- choosing a card ----
const selectedCard = computed(() => (sel.value?.kind === 'card' ? sel.value.id : null));
const selectedInfo = computed(() => (selectedCard.value ? CARD_BY_ID[selectedCard.value] : null));
const inReserve = computed(() => Boolean(selectedCard.value && me.value?.reserved.some((r) => r.card === selectedCard.value)));
const quote = computed(() => (selectedCard.value ? s.value.afford?.[selectedCard.value] ?? null : null));
const goldUsed = computed(() => (quote.value ? Math.min(quote.value.maxGold, Math.max(quote.value.minGold, payGold.value ?? quote.value.minGold)) : 0));
/** The payment for the chosen amount of Gold: Gold replaces gems, starting with the colour paid most. */
const payPlan = computed(() => {
  if (!quote.value) return null;
  const pay = [...quote.value.pay];
  for (let extra = goldUsed.value - quote.value.minGold; extra > 0; extra--) {
    let best = -1;
    for (let c = 0; c < 5; c++) if (pay[c] > 0 && (best === -1 || pay[c] > pay[best])) best = c;
    if (best === -1) break;
    pay[best]--;
    pay[5]++;
  }
  return pay;
});
const missing = computed(() => {
  if (!selectedCard.value || quote.value) return null;
  const left = needOf(selectedCard.value).map((n, c) => Math.max(0, n - tokens.value[c]));
  return { left, gold: Math.max(0, sum(left) - tokens.value[5]), total: sum(left) };
});
const canReserve = computed(() => myTurn.value && me.value && me.value.reserved.length < 3);
const reserveWhy = computed(() => {
  if (!myTurn.value) return s.value.pending ? 'Finish your current choice first.' : 'It is not your turn.';
  if (me.value.reserved.length >= 3) return 'You already have three reserved cards.';
  return '';
});
const goldLeft = computed(() => supply.value[5] > 0);

function payText(pay) {
  const parts = pay.flatMap((n, c) => (n > 0 ? [`${n} ${GEM_NAMES[c]}`] : []));
  if (!parts.length) return 'nothing';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function pickCard(id) {
  message.value = '';
  picks.value = [];
  payGold.value = null;
  sel.value = selectedCard.value === id ? null : { kind: 'card', id };
}
function pickDeck(level) {
  message.value = '';
  picks.value = [];
  sel.value = sel.value?.kind === 'deck' && sel.value.level === level ? null : { kind: 'deck', level };
}

async function buy() {
  if (!quote.value || !myTurn.value || busy.value) return;
  busy.value = true;
  const custom = goldUsed.value !== quote.value.minGold;
  const reply = await props.send('buy', custom ? { card: selectedCard.value, pay: payPlan.value } : { card: selectedCard.value });
  busy.value = false;
  if (reply.ok) sel.value = null;
}
async function reserve() {
  if (!canReserve.value || busy.value) return;
  busy.value = true;
  const reply = await props.send('reserve', sel.value.kind === 'deck' ? { level: sel.value.level } : { card: sel.value.id });
  busy.value = false;
  if (reply.ok) sel.value = null;
}

// ---- returning tokens and choosing a nobles ----
const giveTotal = computed(() => sum(giveBack.value));
function addGive(c) {
  if (!pendingMine.value || giveBack.value[c] >= tokens.value[c] || giveTotal.value >= pendingMine.value.count) return;
  giveBack.value = giveBack.value.map((n, i) => (i === c ? n + 1 : n));
}
function removeGive(c) {
  if (giveBack.value[c] > 0) giveBack.value = giveBack.value.map((n, i) => (i === c ? n - 1 : n));
}
async function confirmGive() {
  if (!pendingMine.value || giveTotal.value !== pendingMine.value.count || busy.value) return;
  busy.value = true;
  const reply = await props.send('giveBack', { tokens: giveBack.value });
  busy.value = false;
  if (reply.ok) giveBack.value = [0, 0, 0, 0, 0, 0];
}
const chooseNoble = (noble) => props.send('noble', { noble });

watch(
  () => `${s.value.turn}:${s.value.round}:${s.value.pending?.type ?? ''}`,
  () => {
    picks.value = [];
    giveBack.value = [0, 0, 0, 0, 0, 0];
    payGold.value = null;
    message.value = '';
  },
);
// A card that left the table (or the reserve) while selected is no longer selected.
watch(
  () => [s.value.board, me.value?.reserved],
  () => {
    if (!selectedCard.value) return;
    const there = [1, 2, 3].some((l) => s.value.board[l].includes(selectedCard.value)) || inReserve.value;
    if (!there) sel.value = null;
  },
);

// ---- the end ----
const winners = computed(() => (s.value.winners ?? []).map((i) => ({ seat: i, name: nameOf(i), ...s.value.standings[i] })));
const iWon = computed(() => (s.value.winners ?? []).includes(s.value.you));
const standings = computed(() => (s.value.standings ?? []).map((x) => ({ ...x, name: nameOf(x.seat) })).sort((a, b) => b.prestige - a.prestige || a.cards - b.cards));
const isHost = computed(() => s.value.hostSeat === s.value.you);
const endNote = computed(() => {
  if (s.value.endReason === 'limit') return 'The game reached its round limit.';
  if (s.value.endReason === 'stalled') return 'Nobody could do anything any more.';
  return '';
});
const tieNote = computed(() => {
  const top = standings.value.filter((x) => x.prestige === standings.value[0]?.prestige);
  if (top.length < 2) return '';
  return winners.value.length === 1 ? 'Level on prestige: the player with fewer cards wins.' : 'Level on prestige and on cards bought: the win is shared.';
});

// ---- fitting the window ----
// The table is as tall as the room below the page title and never taller, so the page does not scroll. Everything
// inside is sized in em, and the table's font size is chosen from the window size alone (never from the game), so
// nothing grows or shrinks while the game is played. It is designed for DESIGN_W x DESIGN_MAIN pixels at 16px text.
const DESIGN_W = 1120;
const DESIGN_MAIN = 512; // the height of the three columns
const CHROME = 100; // the score bar and the status line, which do not scale
const root = ref(null);
const fit = ref({ height: Math.max(360, window.innerHeight - 220), scale: 1 }); // a safe first guess, then measured
function measure() {
  const el = root.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const height = Math.max(380, Math.floor(window.innerHeight - top - 14));
  const width = el.parentElement?.clientWidth || window.innerWidth;
  const scale = Math.min(width / DESIGN_W, (height - CHROME) / DESIGN_MAIN);
  fit.value = { height, scale: Math.round(Math.min(1.35, Math.max(0.5, scale)) * 100) / 100 };
}
const rootStyle = computed(() => ({ height: `${fit.value.height}px`, fontSize: `${16 * fit.value.scale}px` }));
onMounted(() => {
  measure();
  window.addEventListener('resize', measure);
  // Tell the page shell (which scales tall games down) that this screen fits by itself.
  nextTick(() => window.dispatchEvent(new Event('resize')));
});
onBeforeUnmount(() => window.removeEventListener('resize', measure));

// ---- the log: a fixed box that scrolls, newest at the bottom, following the latest unless you scroll up ----
const logEl = ref(null);
let following = true;
const recent = computed(() => s.value.log);
function onLogScroll() {
  const el = logEl.value;
  if (el) following = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
}
async function followLog() {
  await nextTick();
  if (logEl.value && following) logEl.value.scrollTop = logEl.value.scrollHeight;
}
watch(() => s.value.log.length, followLog);
watch(logEl, followLog);
const levels = [3, 2, 1];
</script>

<template>
  <div ref="root" class="table-view" data-fits-window :style="rootStyle">
    <ScoreBoard ref="board" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :target="state.scoreboard.target" :finished="finished" :sticky="false" :round-popups="false">
      <template #footer>
        <button class="primary" data-autofocus @click="board.close()">{{ finished ? 'Close' : 'Continue' }}</button>
        <template v-if="finished">
          <button v-if="isHost" @click="send('again'); board.close()">Play again</button>
          <button class="quiet" @click="send('leave'); board.close()">Leave</button>
        </template>
      </template>
    </ScoreBoard>

    <div class="info">
      <span class="muted round">Round {{ state.round }} · first to {{ state.settings.target }} prestige</span>
      <p class="status" :class="{ mine: myTurn || pendingMine }" role="status" :title="banner">{{ banner }}</p>
      <p v-if="lastRound" class="last-round" role="status" :title="lastRound">{{ lastRound }}</p>
      <button v-if="!finished" class="quiet leave" title="A computer player takes your seat if you leave" @click="send('leave')">Leave game</button>
    </div>

    <div class="layout">
      <section class="market" aria-label="The cards">
        <div class="nobles" aria-label="Nobles">
          <span class="row-title">Nobles</span>
          <div class="noble-row">
            <NobleTile v-for="n in state.nobles" :key="n" :noble="n" :bonuses="bonuses" />
            <span v-if="!state.nobles.length" class="muted">All the nobles have visited.</span>
          </div>
        </div>
        <div v-for="level in levels" :key="level" class="level-row" :aria-label="`Level ${level} cards`">
          <button
            class="pile-button"
            :class="{ chosen: sel?.kind === 'deck' && sel.level === level }"
            :disabled="!state.decks[level]"
            :title="`Reserve the top card of the level ${level} pile without seeing it`"
            :aria-label="`Level ${level} pile, ${state.decks[level]} cards. Select to reserve the top card.`"
            @click="pickDeck(level)"
          >
            <CardFace :level="level" :count="state.decks[level]" />
          </button>
          <template v-for="(id, slot) in state.board[level]" :key="`${level}-${slot}`">
            <CardFace v-if="id" clickable :card="id" :need="needOf(id)" :affordable="Boolean(state.afford?.[id])" :selected="selectedCard === id" @pick="pickCard(id)" />
            <span v-else class="empty-slot" aria-hidden="true" />
          </template>
        </div>
      </section>

      <div class="boards">
        <PlayerBoard
          v-for="i in seatOrder"
          :key="i"
          :seat="state.seats[i]"
          :is-me="i === state.you"
          :is-turn="state.turn === i && !finished"
          :afford="state.afford ?? {}"
          :selected="selectedCard"
          :interactive="!finished"
          @pick="pickCard"
        />
      </div>

      <aside class="side">
        <section class="panel action stack" aria-label="Your move">
          <!-- Returning tokens -->
          <template v-if="pendingMine?.type === 'return'">
            <h3>Return {{ pendingMine.count }} {{ pendingMine.count === 1 ? 'token' : 'tokens' }}</h3>
            <p class="muted">You may hold only 10 tokens. Click the tokens you want to give back.</p>
            <div class="give-row">
              <button v-for="(n, c) in tokens" :key="c" class="stack-btn" :disabled="n - giveBack[c] <= 0 || giveTotal >= pendingMine.count" @click="addGive(c)">
                <Gem :colour="c" :size="26" :count="n - giveBack[c]" :faded="n - giveBack[c] === 0" />
              </button>
            </div>
            <div class="row">
              <span class="muted">Returning:</span>
              <button v-for="(n, c) in giveBack" v-show="n > 0" :key="c" class="chip" :title="`Keep one ${GEM_NAMES[c]}`" @click="removeGive(c)"><Gem :colour="c" :size="16" :count="n" /> ✕</button>
              <span v-if="!giveTotal" class="muted">nothing yet</span>
            </div>
            <button class="primary" :disabled="giveTotal !== pendingMine.count || busy" @click="confirmGive">Return {{ giveTotal }} of {{ pendingMine.count }}</button>
          </template>

          <!-- Choosing a noble -->
          <template v-else-if="pendingMine?.type === 'noble'">
            <h3>Choose a noble</h3>
            <p class="muted">Several nobles would like to visit you, but only one can. Click the one you choose (each is worth 3 prestige).</p>
            <div class="noble-row">
              <NobleTile v-for="n in pendingMine.options" :key="n" :noble="n" clickable highlight :bonuses="bonuses" @pick="chooseNoble(n)" />
            </div>
          </template>

          <template v-else-if="finished">
            <h3>Game over</h3>
            <p class="muted">See the scores for the whole game, or play again.</p>
            <button class="primary" @click="board.show()">Show the scores</button>
          </template>

          <!-- A card is selected -->
          <template v-else-if="sel?.kind === 'card'">
            <h3>Level {{ selectedInfo.level }} card</h3>
            <p class="detail">
              <b>{{ selectedInfo.points }}</b> prestige · gives a <Gem :colour="selectedInfo.bonus" :size="13" /> {{ GEM_NAMES[selectedInfo.bonus] }} bonus
            </p>
            <template v-if="quote">
              <p class="pay">
                You can afford it. You would pay
                <span v-for="(n, c) in payPlan" v-show="n > 0" :key="c" class="paychip"><Gem :colour="c" :size="18" :count="n" /></span>
                <span v-if="!sum(payPlan)">nothing</span>
                <span class="sr-only">({{ payText(payPlan) }})</span>
              </p>
              <p class="muted small-text">That is {{ payText(payPlan) }}<template v-if="payPlan[5]"> (using {{ payPlan[5] }} Gold)</template>.</p>
              <div v-if="quote.maxGold > quote.minGold" class="row gold-choice">
                <span class="muted">Pay with Gold:</span>
                <button class="quiet" :disabled="goldUsed <= quote.minGold" aria-label="Use less Gold" @click="payGold = goldUsed - 1">−</button>
                <b>{{ goldUsed }}</b>
                <button class="quiet" :disabled="goldUsed >= quote.maxGold" aria-label="Use more Gold" @click="payGold = goldUsed + 1">+</button>
              </div>
            </template>
            <p v-else class="cannot">
              You cannot afford this yet: you are short of
              <template v-if="missing.total - Math.min(missing.total, tokens[5]) > 0 || missing.total > 0">
                <span v-for="(n, c) in missing.left" v-show="n > 0" :key="c" class="paychip"><Gem :colour="c" :size="18" :count="n" /></span>
                <template v-if="tokens[5]"> (your {{ tokens[5] }} Gold can cover {{ Math.min(tokens[5], missing.total) }})</template>
              </template>
              .
            </p>
            <div class="row">
              <button class="primary" :disabled="!quote || !myTurn || busy" :title="!myTurn ? reserveWhy : !quote ? 'You cannot afford this card' : ''" @click="buy">Buy this card</button>
              <button v-if="!inReserve" :disabled="!canReserve || busy" :title="reserveWhy" @click="reserve">Reserve<template v-if="goldLeft"> (+1 Gold)</template><template v-else> (no Gold left)</template></button>
              <button class="quiet" @click="sel = null">Cancel</button>
            </div>
            <p v-if="!myTurn && !pendingMine" class="muted small-text">{{ s.pending ? 'Wait for the other player to finish.' : 'You can look at cards now, but can only act on your own turn.' }}</p>
          </template>

          <!-- A pile is selected -->
          <template v-else-if="sel?.kind === 'deck'">
            <h3>Reserve from the level {{ sel.level }} pile</h3>
            <p class="muted">You take the top card without seeing it first. Only you will know what it is until you buy it. {{ goldLeft ? 'You also take 1 Gold.' : 'There is no Gold left, so you take none.' }}</p>
            <div class="row">
              <button class="primary" :disabled="!canReserve || busy" :title="reserveWhy" @click="reserve">Reserve the top card</button>
              <button class="quiet" @click="sel = null">Cancel</button>
            </div>
          </template>

          <!-- Taking gems -->
          <template v-else>
            <h3>{{ myTurn ? 'Your move' : 'Gems' }}</h3>
            <p class="muted small-text">Click gems to take them, or click a card to buy or reserve it.</p>
            <div class="picks" aria-live="polite">
              <span class="muted">Selected:</span>
              <Gem v-for="(c, i) in picks" :key="i" :colour="c" :size="22" />
              <span v-if="!picks.length" class="muted">none</span>
            </div>
            <p class="check" :class="{ ok: takeCheck.ok }">{{ takeCheck.text }}</p>
            <div class="row">
              <button class="primary" :disabled="!takeCheck.ok || !myTurn || busy" @click="confirmTake">Take {{ picks.length || '' }} {{ picks.length === 1 ? 'gem' : 'gems' }}</button>
              <button class="quiet" :disabled="!picks.length" @click="picks = []">Clear</button>
              <button v-if="state.canPass" @click="send('pass')">Pass (nothing else is possible)</button>
            </div>
          </template>
          <p v-if="message" class="notice" role="alert">{{ message }}</p>
        </section>

        <section class="panel supply" aria-label="The gem supply">
          <span class="row-title">Supply</span>
          <div class="stacks">
            <button
              v-for="c in [0, 1, 2, 3, 4]"
              :key="c"
              class="stack-btn"
              :class="{ picked: picks.includes(c) }"
              :aria-pressed="picks.includes(c)"
              :aria-label="`${GEM_NAMES[c]}: ${supply[c]} left`"
              @click="clickGem(c)"
            >
              <Gem :colour="c" :size="34" :count="supply[c]" :faded="supply[c] === 0" />
              <span v-if="picks.filter((x) => x === c).length" class="badge">{{ picks.filter((x) => x === c).length }}</span>
              <small class="muted">{{ GEM_NAMES[c] }}</small>
            </button>
            <span class="stack-btn gold" :title="'Gold is wild. You gain it by reserving a card.'">
              <Gem :colour="5" :size="34" :count="supply[5]" :faded="supply[5] === 0" />
              <small class="muted">Gold</small>
            </span>
          </div>
        </section>

        <section v-if="!finished" class="panel log" aria-label="Recent moves">
          <span class="row-title">Recent moves</span>
          <ol ref="logEl" @scroll="onLogScroll">
            <li v-for="(e, i) in recent" :key="`${e.round}-${i}-${e.kind}`" :class="{ mine: e.seat === state.you }">
              <span class="r">R{{ e.round }}</span>
              <b>{{ nameOf(e.seat) }}</b>
              <template v-if="e.kind === 'take'">
                took <Gem v-for="c in e.colours" :key="c" :colour="c" :size="13" />
              </template>
              <template v-else-if="e.kind === 'take2'">took two <Gem :colour="e.colour" :size="13" /></template>
              <template v-else-if="e.kind === 'reserve'">
                reserved
                <template v-if="e.card">a level {{ e.level }} card <Gem :colour="CARD_BY_ID[e.card].bonus" :size="13" /></template>
                <template v-else>the top card of pile {{ e.level }}</template>
                <template v-if="e.gold"> and took <Gem :colour="5" :size="13" /></template>
              </template>
              <template v-else-if="e.kind === 'buy'">
                bought a level {{ e.level }} card <Gem :colour="CARD_BY_ID[e.card].bonus" :size="13" /><template v-if="CARD_BY_ID[e.card].points"> (+{{ CARD_BY_ID[e.card].points }})</template>
              </template>
              <template v-else-if="e.kind === 'return'">returned {{ e.give.reduce((a, b) => a + b, 0) }} tokens</template>
              <template v-else-if="e.kind === 'noble'">was visited by {{ NOBLE_BY_ID[e.noble].name }} (+3)</template>
              <template v-else-if="e.kind === 'pass'">passed</template>
            </li>
            <li v-if="!recent.length" class="muted">Nothing has happened yet.</li>
          </ol>
        </section>
        <section v-if="finished" class="panel end" aria-label="The result">
          <h2 v-if="winners.length === 1">{{ winners[0].name }}{{ winners[0].seat === state.you ? ' (you)' : '' }} wins with {{ winners[0].prestige }} prestige!</h2>
          <h2 v-else-if="winners.length">A shared win: {{ winners.map((w) => w.name).join(' and ') }} with {{ winners[0].prestige }} prestige.</h2>
          <p v-if="iWon" class="muted">Well played.</p>
          <p v-if="tieNote" class="muted">{{ tieNote }}</p>
          <p v-if="endNote" class="muted">{{ endNote }}</p>
          <ol class="standings">
            <li v-for="x in standings" :key="x.seat">
              <b>{{ x.name }}</b> <span>{{ x.prestige }} prestige</span> <span class="muted">{{ x.cards }} {{ x.cards === 1 ? 'card' : 'cards' }}, {{ x.nobles }} {{ x.nobles === 1 ? 'noble' : 'nobles' }}</span>
            </li>
          </ol>
          <div class="row">
            <button v-if="isHost" class="primary" @click="send('again')">Play again</button>
            <span v-else class="muted">Waiting for the host to start another game.</span>
            <button class="quiet" @click="send('leave')">Leave</button>
          </div>
        </section>
      </aside>
    </div>

  </div>
</template>

<style scoped>
/* Everything is sized in em: the table's font size is set from the window (see "fitting the window"), so the layout is
   one fixed shape that fills the room under the page title. Nothing here depends on how much has happened in the game. */
.table-view {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  box-sizing: border-box;
  overflow: hidden;
}
.info {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  height: 1.9rem;
  flex: none;
  min-width: 0;
}
.info > * {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.round {
  flex: none;
  font-size: 0.85rem;
}
.status {
  margin: 0;
  flex: 1;
  font-family: var(--display);
  font-size: 1.05rem;
}
.status.mine {
  color: var(--amber);
}
.last-round {
  margin: 0;
  flex: 0 1 auto;
  padding: 0.1rem 0.6rem;
  border: 1px solid var(--amber);
  border-radius: 999px;
  color: var(--amber);
  font-size: 0.8rem;
}
.leave {
  flex: none;
  margin-left: auto;
  padding: 0.1rem 0.8rem;
  font-size: 0.8rem;
}
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 0.8em;
}
.layout > * {
  min-height: 0;
  min-width: 0;
}
.market {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  padding: 0.6em;
  border-radius: 0.8em;
  background: radial-gradient(900px 400px at 30% 0%, rgb(255 255 255 / 0.04), transparent), rgb(8 18 22 / 0.55);
  border: 1px solid var(--line);
  overflow: hidden;
}
.row-title {
  font-size: 0.65em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.nobles {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
}
.noble-row {
  display: flex;
  gap: 0.5em;
  flex-wrap: wrap;
  align-items: flex-start;
}
.nobles > .noble-row {
  min-height: 6.2em;
}
.level-row {
  display: flex;
  gap: 0.5em;
  align-items: center;
}
.empty-slot {
  flex: none;
  width: 5.2em;
  height: 7em;
  box-sizing: border-box;
  border-radius: 0.6em;
  border: 2px dashed var(--line);
}
.pile-button {
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 0.6em;
  background: none;
  position: relative;
}
.pile-button::before,
.pile-button::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.6em;
  background: var(--card-back, #4a1420);
  border: 0.2em solid #f4efe3;
  z-index: -1;
  transform: translate(0.15em, 0.15em);
}
.pile-button::after {
  transform: translate(0.3em, 0.3em);
  opacity: 0.7;
}
.pile-button:hover:not(:disabled) {
  background: none;
}
.pile-button.chosen :deep(.dev-card) {
  box-shadow: 0 0 0 3px var(--amber);
}
.pile-button:disabled {
  opacity: 0.3;
}
.boards {
  display: flex;
  flex-direction: column;
  gap: 0.45em;
  align-content: start;
  overflow: hidden;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
}
.side > .panel {
  padding: 0.5em 0.6em;
  border-radius: 0.8em;
  box-sizing: border-box;
}
.action {
  flex: none;
  height: 15.5em;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35em;
}
.action h3 {
  font-size: 1rem;
  margin: 0;
}
.action .muted,
.action p {
  font-size: 0.85rem;
}
.small-text {
  font-size: 0.8rem;
  margin: 0;
}
.detail {
  margin: 0;
}
.detail :deep(.gem),
.pay :deep(.gem),
.cannot :deep(.gem) {
  vertical-align: middle;
}
.pay,
.cannot {
  margin: 0;
}
.cannot {
  color: var(--danger);
}
.paychip {
  display: inline-flex;
}
.gold-choice {
  gap: 0.4rem;
}
.gold-choice button {
  padding: 0.1rem 0.7rem;
}
.picks {
  display: flex;
  align-items: center;
  gap: 0.3em;
  min-height: 1.6em;
}
.check {
  margin: 0;
  color: var(--muted);
}
.check.ok {
  color: var(--moss);
}
.notice {
  margin: 0;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--danger);
  border-radius: 10px;
  color: var(--danger);
  font-size: 0.8rem;
}
.supply {
  flex: none;
}
.supply .stacks {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.3em;
  margin-top: 0.2em;
}
.give-row {
  display: flex;
  gap: 0.3em;
  flex-wrap: wrap;
}
.stack-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.05em;
  padding: 0.2em 0.1em 0.1em;
  border-radius: 0.7em;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  min-width: 0;
}
span.stack-btn {
  opacity: 0.95;
}
.stack-btn small {
  font-size: 0.55em;
}
.stack-btn.picked {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px var(--amber);
}
.badge {
  position: absolute;
  top: -0.4em;
  right: -0.2em;
  min-width: 1.2em;
  height: 1.2em;
  border-radius: 999px;
  background: var(--amber);
  color: var(--amber-ink);
  font-size: 0.7em;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.5rem;
}
.log,
.end {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.log ol {
  list-style: none;
  margin: 0.2em 0 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  font-size: 0.78em;
}
.log li {
  display: block;
  line-height: 1.5;
}
.log li :deep(.gem) {
  vertical-align: middle;
  margin: 0 1px;
}
.log li b {
  margin-right: 0.25em;
}
.log li.mine b {
  color: var(--amber);
}
.log .r {
  font-size: 0.8em;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 0.25em;
}
.end {
  gap: 0.3em;
  overflow: auto;
}
.end h2 {
  color: var(--amber);
  font-size: 1.1rem;
  margin: 0;
}
.end p {
  margin: 0;
  font-size: 0.85rem;
}
.standings {
  margin: 0;
  padding-left: 1.2em;
  font-size: 0.85rem;
}
.standings li {
  display: flex;
  gap: 0.8em;
  flex-wrap: wrap;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
