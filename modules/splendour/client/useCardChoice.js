// Choosing a card (or a pile) to buy or reserve at the Splendour table: the selection, what it would cost this player,
// and the buy and reserve requests.
import { computed, watch } from 'vue';
import { CARD_BY_ID } from '../cards.js';
import { MAX_RESERVED } from '../rules.js';
import { sum } from './tableView.js';

/**
 * Card choosing.
 *
 * Side effects: pickCard and pickDeck change the shared sel, picks, message and payGold; buy and reserve send requests and
 * clear the selection on success; a watcher drops a selected card that has left the table or the reserve.
 *
 * @param {object} view    the table view (reactive)
 * @param {object} shared  the shared choice state (reactive)
 * @param {Function} send  sends an action to the server and resolves with its reply
 * @returns {object} selectedCard, selectedLevel (the level of the selected pile, or null), selectedInfo, inReserve, quote, goldUsed, payPlan, missing, canReserve, reserveWhy,
 *   goldLeft, pickCard(id), pickDeck(level), setGold(n), cancel(), buy(), reserve()
 */
export function useCardChoice(view, shared, send) {
  const selectedCard = computed(() => (shared.sel?.kind === 'card' ? shared.sel.id : null));
  const selectedLevel = computed(() => (shared.sel?.kind === 'deck' ? shared.sel.level : null));
  const selectedInfo = computed(() => (selectedCard.value ? CARD_BY_ID[selectedCard.value] : null));
  const inReserve = computed(() => Boolean(selectedCard.value && view.me?.reserved.some((r) => r.card === selectedCard.value)));
  const quote = computed(() => (selectedCard.value ? view.s.afford?.[selectedCard.value] ?? null : null));
  const goldUsed = computed(() => (quote.value ? Math.min(quote.value.maxGold, Math.max(quote.value.minGold, shared.payGold ?? quote.value.minGold)) : 0));
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
    const left = view.needOf(selectedCard.value).map((n, c) => Math.max(0, n - view.tokens[c]));
    return { left, gold: Math.max(0, sum(left) - view.tokens[5]), total: sum(left) };
  });
  const canReserve = computed(() => view.myTurn && view.me && view.me.reserved.length < MAX_RESERVED);
  const reserveWhy = computed(() => {
    if (!view.myTurn) return view.s.pending ? 'Finish your current choice first.' : 'It is not your turn.';
    if (view.me.reserved.length >= MAX_RESERVED) return 'You already have three reserved cards.';
    return '';
  });
  const goldLeft = computed(() => view.supply[5] > 0);

  /**
   * Selects a card, or deselects it when it is already selected.
   *
   * @param {string} id  a card id
   */
  function pickCard(id) {
    shared.message = '';
    shared.picks = [];
    shared.payGold = null;
    shared.sel = selectedCard.value === id ? null : { kind: 'card', id };
  }
  /**
   * Selects a pile (to reserve its top card blind), or deselects it when it is already selected.
   *
   * @param {number} level  the pile's level (1 to 3)
   */
  function pickDeck(level) {
    shared.message = '';
    shared.picks = [];
    shared.sel = shared.sel?.kind === 'deck' && shared.sel.level === level ? null : { kind: 'deck', level };
  }
  /**
   * Chooses how much Gold to pay with (the amount is clamped to what the quote allows).
   *
   * @param {number} n  the amount of Gold
   */
  function setGold(n) {
    shared.payGold = n;
  }
  /** Drops the selection. */
  function cancel() {
    shared.sel = null;
  }

  /** Buys the selected card, with a custom payment only when the amount of Gold was changed. */
  async function buy() {
    if (!quote.value || !view.myTurn || shared.busy) return;
    shared.busy = true;
    const custom = goldUsed.value !== quote.value.minGold;
    const reply = await send('buy', custom ? { card: selectedCard.value, pay: payPlan.value } : { card: selectedCard.value });
    shared.busy = false;
    if (reply.ok) shared.sel = null;
  }
  /** Reserves the selected card, or the top card of the selected pile. */
  async function reserve() {
    if (!canReserve.value || shared.busy) return;
    shared.busy = true;
    const reply = await send('reserve', shared.sel.kind === 'deck' ? { level: shared.sel.level } : { card: shared.sel.id });
    shared.busy = false;
    if (reply.ok) shared.sel = null;
  }

  // A card that left the table (or the reserve) while selected is no longer selected.
  watch(
    () => [view.s.board, view.me?.reserved],
    () => {
      if (!selectedCard.value) return;
      const there = [1, 2, 3].some((l) => view.s.board[l].includes(selectedCard.value)) || inReserve.value;
      if (!there) shared.sel = null;
    },
  );

  return { selectedCard, selectedLevel, selectedInfo, inReserve, quote, goldUsed, payPlan, missing, canReserve, reserveWhy, goldLeft, pickCard, pickDeck, setGold, cancel, buy, reserve };
}
