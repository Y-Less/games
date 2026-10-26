<script setup>
// The table: scoreboard, nobles, the three rows of cards, the gem supply, your actions, every player's board and the log.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { CARD_BY_ID, NOBLE_BY_ID } from '../cards.js';
import CardFace from './CardFace.vue';
import Gem from './Gem.vue';
import { GEM_NAMES } from './gems.js';
import { fontSize, px } from './layout.js';
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
  if (finished.value) return winners.value.length === 1 ? `${winners.value[0].name}${winners.value[0].seat === s.value.you ? ' (you)' : ''} wins with ${winners.value[0].prestige} prestige!` : winners.value.length ? `A shared win: ${winners.value.map((w) => w.name).join(' and ')} with ${winners.value[0].prestige} prestige.` : 'The game is over.';
  const pending = s.value.pending;
  if (pending && pending.seat === s.value.you) return pending.type === 'return' ? `You have more than 10 tokens: return ${pending.count}.` : 'Choose a noble: click the one you want in the market.';
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
/** Clicking one of your own tokens while returning: mark one more for return, or (when no more can be marked) take one back. */
function clickToken(c) {
  if (!pendingMine.value) return;
  const full = giveBack.value[c] >= tokens.value[c] || giveTotal.value >= pendingMine.value.count;
  if (!full) addGive(c);
  else removeGive(c);
}
const chooseNoble = (noble) => props.send('noble', { noble });
const choosingNoble = computed(() => pendingMine.value?.type === 'noble');
const canPickNoble = (id) => Boolean(choosingNoble.value && pendingMine.value.options.includes(id));

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

// ---- other players' boards: hidden until you click their name in the score bar, one at a time, over the main area
// (nothing moves) ----
const others = computed(() => seatOrder.value.filter((i) => i !== s.value.you).map((i) => s.value.seats[i]));
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostSeat,
  isHost: () => isHost.value,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
const openedSeat = computed(() => others.value.find((o) => o.seat === openId.value) ?? null);

// ---- the words in the Status box ----
const statusLines = computed(() => {
  const lines = [];
  if (message.value) lines.push({ text: message.value, tone: 'warn' });
  if (lastRound.value) lines.push({ text: lastRound.value, tone: 'mine' });
  const pending = pendingMine.value;
  if (pending?.type === 'return') lines.push({ text: `You may hold only 10 tokens. Click your own tokens to mark the ${pending.count} you want to give back, then press Return.`, tone: 'muted' });
  else if (pending?.type === 'noble') lines.push({ text: 'Several nobles would like to visit you, but only one can. Click the highlighted noble you choose in the market (each is worth 3 prestige).', tone: 'muted' });
  else if (finished.value) {
    if (tieNote.value) lines.push({ text: tieNote.value, tone: 'muted' });
    if (endNote.value) lines.push({ text: endNote.value, tone: 'muted' });
    if (iWon.value) lines.push({ text: 'Well played.', tone: 'muted' });
  }
  else if (sel.value?.kind === 'card') {
    const card = selectedInfo.value;
    lines.push({ text: `Level ${card.level} card: ${card.points} prestige, gives a ${GEM_NAMES[card.bonus]} bonus.`, tone: 'mine' });
    if (quote.value) {
      lines.push(`You can afford it. You would pay ${payText(payPlan.value)}${payPlan.value[5] ? ` (using ${payPlan.value[5]} Gold)` : ''}.`);
    } else {
      const short = missing.value.left.map((n, c) => (n > 0 ? [`${n} ${GEM_NAMES[c]}`] : [])).flat();
      lines.push({ text: `You cannot afford this yet: you are short of ${short.join(', ') || 'Gold'}${tokens.value[5] ? ` (your ${tokens.value[5]} Gold can cover ${Math.min(tokens.value[5], missing.value.total)})` : ''}.`, tone: 'warn' });
    }
    if (!myTurn.value && !pendingMine.value) lines.push({ text: s.value.pending ? 'Wait for the other player to finish.' : 'You can look at cards now, but can only act on your own turn.', tone: 'muted' });
  } else if (sel.value?.kind === 'deck') {
    lines.push({ text: `Reserve from the level ${sel.value.level} pile: you take the top card without seeing it first. Only you will know what it is until you buy it. ${goldLeft.value ? 'You also take 1 Gold.' : 'There is no Gold left, so you take none.'}`, tone: 'mine' });
  } else if (!pending) {
    lines.push({ text: takeCheck.value.text, tone: takeCheck.value.ok ? 'mine' : 'muted' });
    lines.push({ text: 'Click gems to take them, or click a card to buy or reserve it.', tone: 'muted' });
  }
  return lines;
});

// ---- fitting the room: one font size from the area the frame gives the table (see layout.js) ----
const fs = (area) => ({ fontSize: `${fontSize(area)}px` });
const recent = computed(() => s.value.log);
const levels = [3, 2, 1];
</script>

<template>
  <GameFrame class="table-view" :main-span="8">
    <template #scorebar>
      <ScoreBoard ref="board" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :target="state.scoreboard.target" :finished="finished" :sticky="false" :round-popups="false" v-bind="scoreProps">
        <template #footer>
          <button class="primary" data-autofocus @click="board.close()">{{ finished ? 'Close' : 'Continue' }}</button>
          <button v-if="finished && isHost" @click="send('again'); board.close()">Play again</button>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <div class="arena" :style="fs(area)">
        <PlayerPopup v-if="popupProps" v-bind="popupProps">
          <PlayerBoard v-if="openedSeat" :seat="openedSeat" :is-turn="state.turn === openedSeat.seat && !finished" :gem="px(area, 1.8)" />
        </PlayerPopup>
        <section class="market" aria-label="The cards">
          <div class="nobles" aria-label="Nobles">
            <span class="row-title">Nobles</span>
            <div class="noble-row noble-grid" style="grid-template-columns: repeat(2, 5.8em)">
              <NobleTile v-for="n in state.nobles" :key="n" :noble="n" :bonuses="bonuses" :clickable="canPickNoble(n)" :highlight="canPickNoble(n)" :dimmed="choosingNoble && !canPickNoble(n)" @pick="chooseNoble(n)" />
              <span v-if="!state.nobles.length" class="muted">All the nobles have visited.</span>
            </div>
          </div>
          <div class="levels">
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
          </div>
        </section>

        <div class="mine-col">
          <PlayerBoard
            v-if="me"
            class="mine-board"
            :seat="me"
            is-me
            :is-turn="turnIsMine && !finished"
            :afford="state.afford ?? {}"
            :selected="selectedCard"
            :interactive="!finished"
            large
            :gem="px(area, 2.2)"
            :pick-tokens="pendingMine?.type === 'return'"
            :give="giveBack"
            @pick="pickCard"
            @token="clickToken"
          >
            <template #actions>
              <!-- Returning tokens: the confirm button; the tokens above are the selector -->
              <template v-if="pendingMine?.type === 'return'">
                <button class="primary" :disabled="giveTotal !== pendingMine.count || busy" @click="confirmGive">Return {{ giveTotal }} of {{ pendingMine.count }}</button>
                <button v-if="giveTotal" class="quiet" @click="giveBack = [0, 0, 0, 0, 0, 0]">Clear</button>
              </template>
              <!-- A card is selected -->
              <template v-else-if="sel?.kind === 'card'">
                <button class="primary" :disabled="!quote || !myTurn || busy" :title="!myTurn ? reserveWhy : !quote ? 'You cannot afford this card' : ''" @click="buy">Buy this card</button>
                <button v-if="!inReserve" :disabled="!canReserve || busy" :title="reserveWhy" @click="reserve">Reserve<template v-if="goldLeft"> (+1 Gold)</template><template v-else> (no Gold left)</template></button>
                <span v-if="quote && quote.maxGold > quote.minGold" class="gold-choice">
                  <span class="muted">Gold:</span>
                  <button class="quiet" :disabled="goldUsed <= quote.minGold" aria-label="Use less Gold" @click="payGold = goldUsed - 1">−</button>
                  <b>{{ goldUsed }}</b>
                  <button class="quiet" :disabled="goldUsed >= quote.maxGold" aria-label="Use more Gold" @click="payGold = goldUsed + 1">+</button>
                </span>
                <button class="quiet" @click="sel = null">Cancel</button>
              </template>
              <!-- A pile is selected -->
              <template v-else-if="sel?.kind === 'deck'">
                <button class="primary" :disabled="!canReserve || busy" :title="reserveWhy" @click="reserve">Reserve the top card</button>
                <button class="quiet" @click="sel = null">Cancel</button>
              </template>
              <!-- Taking gems: the gems are chosen in the supply -->
              <template v-else-if="!pendingMine && !finished">
                <template v-if="picks.length">
                  <button class="primary" :disabled="!takeCheck.ok || !myTurn || busy" @click="confirmTake">Take {{ picks.length }} {{ picks.length === 1 ? 'gem' : 'gems' }}</button>
                  <button class="quiet" @click="picks = []">Clear</button>
                </template>
                <button v-if="state.canPass" @click="send('pass')">Pass (nothing else is possible)</button>
              </template>
            </template>
          </PlayerBoard>
          <section class="supply" aria-label="The gem supply">
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
                <Gem :colour="c" :size="px(area, 2.5)" :count="supply[c]" :faded="supply[c] === 0" />
                <span v-if="picks.filter((x) => x === c).length" class="badge">{{ picks.filter((x) => x === c).length }}</span>
                <small class="muted">{{ GEM_NAMES[c] }}</small>
              </button>
              <span class="stack-btn gold" :title="'Gold is wild. You gain it by reserving a card.'">
                <Gem :colour="5" :size="px(area, 2.5)" :count="supply[5]" :faded="supply[5] === 0" />
                <small class="muted">Gold</small>
              </span>
            </div>
          </section>
        </div>
      </div>
    </template>

    <template #log>
      <GameLog :entries="recent" newest-first empty="Nothing has happened yet." v-slot="{ entry: e }">
        <span class="move" :class="{ own: e.seat === state.you }">
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
        </span>
      </GameLog>
    </template>

    <template #status>
      <GameStatus :headline="banner" :mine="Boolean(myTurn || pendingMine)" :lines="statusLines">
        <template #facts>
          <strong>Round {{ state.round }}</strong>
          <span>First to {{ state.settings.target }} prestige</span>
          <span>Piles left: {{ levels.map((l) => `${state.decks[l]} (level ${l})`).join(', ') }}</span>
        </template>
        <template v-if="finished">
          <ol class="standings">
            <li v-for="x in standings" :key="x.seat">
              <b>{{ x.name }}</b> <span>{{ x.prestige }} prestige</span> <span class="muted">{{ x.cards }} {{ x.cards === 1 ? 'card' : 'cards' }}, {{ x.nobles }} {{ x.nobles === 1 ? 'noble' : 'nobles' }}</span>
            </li>
          </ol>
          <div class="end-actions">
            <button v-if="isHost" class="primary" @click="send('again')">Play again</button>
            <span v-else class="muted">Waiting for the host to start another game, or leave (top right).</span>
            <button @click="board.show()">Show the scores</button>
          </div>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
/* Everything in the arena is sized in em: the font size is set from the area the frame gives the table (see layout.js),
   so the layout is one fixed shape on the frame's grid. Nothing here depends on how much has happened in the game. */
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}
.arena > * {
  min-width: 0;
  min-height: 0;
}
.market {
  grid-column: span 8;
  display: grid;
  grid-template-columns: subgrid; /* nobles: 2 columns, cards: 6 */
  grid-template-rows: minmax(0, 1fr);
}
.nobles {
  grid-column: span 2;
}
.levels {
  grid-column: span 6;
}
.levels {
  padding-bottom: 0.4em; /* room for the shadow cards behind each pile */
  display: flex;
  flex-direction: column;
  justify-content: space-between;
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
/* Nobles go two to a row (up to six of them in three rows), so the column never grows taller than the cards beside it. */
.nobles > .noble-grid {
  display: grid;
  gap: 0.5em;
  align-content: start;
  grid-auto-rows: 7.8em;
  justify-content: start;
}
/* a noble is never bigger than a development card (5.8em wide) */
.noble-grid :deep(.noble) {
  width: 100%;
  max-width: 5.8em;
  height: 100%;
  justify-content: center;
}
.level-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.empty-slot {
  flex: none;
  width: 5.8em;
  height: 7.8em;
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

/* your board, big, with the gem supply under it */
.mine-col {
  grid-column: span 4;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.6em;
}
.mine-board {
  flex: none;
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

/* the buttons for what you are doing live in your own board (its bottom row); the words are in the Status box */
.gold-choice {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.gold-choice button {
  padding: 0.05rem 0.6rem;
}
.standings {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.85rem;
}
.standings li {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.end-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

/* another player's board, over the middle of the table */
.arena {
  position: relative;
}

/* the log */
.move {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--muted);
}
.move :deep(.gem) {
  vertical-align: middle;
  margin: 0 1px;
}
.move b {
  margin-right: 0.25em;
}
.move.own {
  color: var(--parchment);
}
.move.own b {
  color: var(--amber);
}
.move .r {
  font-size: 0.8em;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 0.25em;
  margin-right: 0.3em;
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
