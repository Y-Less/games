// Tests for the Splendour table's composables, on small hand-made views.  The composables say everything in messages
// (shared/messages.js), so `words` puts one into English exactly as the table does.
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { messageText } from '../../../src/messageText.js';
import { createChoiceState } from './choiceState.js';
import { useTableView } from './tableView.js';
import { useCardChoice } from './useCardChoice.js';
import { useEnding } from './useEnding.js';
import { useGemTake } from './useGemTake.js';
import { useTokenReturn } from './useTokenReturn.js';

/**
 * Builds a minimal view with me in seat 0, on my turn.
 *
 * @param {object} extra  fields to override
 * @returns {object} a state like the server's
 */
const makeState = (extra = {}) => ({
  phase: 'playing',
  you: 0,
  turn: 0,
  round: 1,
  pending: null,
  supply: [4, 4, 4, 4, 0, 5],
  board: { 1: [], 2: [], 3: [] },
  seats: [{ seat: 0, name: 'Ann', tokens: [1, 0, 0, 0, 0, 2], bonuses: [0, 0, 0, 0, 0], reserved: [] }, { seat: 1, name: 'Bob', tokens: [0, 0, 0, 0, 0, 0], bonuses: [0, 0, 0, 0, 0], reserved: [] }],
  ...extra,
});
const setup = (state, send = vi.fn(() => Promise.resolve({ ok: true }))) => {
  const view = reactive(useTableView(() => state.value));
  const shared = reactive(createChoiceState());
  return { view, shared, send };
};
const ref = (value) => reactive({ value });
const words = (message) => messageText(message, 'splendour');

describe('useGemTake', () => {
  it('picks three different gems, then refuses a fourth', () => {
    const { view, shared, send } = setup(ref(makeState()));
    const take = reactive(useGemTake(view, shared, send));
    take.clickGem(0);
    take.clickGem(1);
    expect(take.takeCheck.ok).toBe(false);
    take.clickGem(2);
    expect(take.takeCheck.ok).toBe(true);
    take.clickGem(3);
    expect(words(shared.message)).toContain('at most three');
    expect(shared.picks).toEqual([0, 1, 2]);
  });

  it('makes a pair from a second click when four are left, and refuses an empty stack', () => {
    const { view, shared, send } = setup(ref(makeState()));
    const take = reactive(useGemTake(view, shared, send));
    take.clickGem(0);
    take.clickGem(0);
    expect(take.isPair).toBe(true);
    take.clickGem(4);
    expect(shared.picks).toEqual([4]); // from a pair, another colour starts again
    shared.picks = [];
    take.clickGem(4);
    expect(words(shared.message)).toContain('no ');
  });

  it('sends the take and clears the picks, keeping them on a refusal', async () => {
    const { view, shared } = setup(ref(makeState()));
    const send = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const take = reactive(useGemTake(view, shared, send));
    [0, 1, 2].forEach((c) => take.clickGem(c));
    await take.confirmTake();
    expect(shared.picks).toEqual([0, 1, 2]);
    await take.confirmTake();
    expect(send).toHaveBeenLastCalledWith('take', { colours: [0, 1, 2] });
    expect(shared.picks).toEqual([]);
  });

  it('says it is not your turn', () => {
    const { view, shared, send } = setup(ref(makeState({ turn: 1 })));
    reactive(useGemTake(view, shared, send)).clickGem(0);
    expect(words(shared.message)).toBe('It is not your turn.');
  });
});

describe('useCardChoice', () => {
  it('selects and deselects a card and a pile, one at a time', () => {
    const { view, shared, send } = setup(ref(makeState({ board: { 1: ['x'], 2: [], 3: [] } })));
    const card = reactive(useCardChoice(view, shared, send));
    card.pickCard('x');
    expect(card.selectedCard).toBe('x');
    card.pickCard('x');
    expect(card.selectedCard).toBe(null);
    card.pickDeck(2);
    expect(card.selectedLevel).toBe(2);
    card.cancel();
    expect(shared.sel).toBe(null);
  });

  it('spends extra Gold from the colour paid most, within the quote', () => {
    const state = ref(makeState({ afford: { x: { pay: [2, 1, 0, 0, 0, 0], minGold: 0, maxGold: 2 } } }));
    const { view, shared, send } = setup(state);
    const card = reactive(useCardChoice(view, shared, send));
    card.pickCard('x');
    expect(card.goldUsed).toBe(0);
    card.setGold(1);
    expect(card.payPlan).toEqual([1, 1, 0, 0, 0, 1]);
    card.setGold(9);
    expect(card.goldUsed).toBe(2);
    expect(card.payPlan).toEqual([0, 1, 0, 0, 0, 2]);
  });

  it('refuses to reserve when it is not your turn', () => {
    const { view, shared, send } = setup(ref(makeState({ turn: 1 })));
    const card = reactive(useCardChoice(view, shared, send));
    expect(card.canReserve).toBeFalsy();
    expect(words(card.reserveWhy)).toBe('It is not your turn.');
  });
});

describe('useTokenReturn', () => {
  it('marks tokens up to what you hold and must return, and takes one back when full', () => {
    const state = ref(makeState({ pending: { seat: 0, type: 'return', count: 2 } }));
    const { view, shared, send } = setup(state);
    const give = reactive(useTokenReturn(view, shared, send));
    give.clickToken(0);
    give.clickToken(0); // only one of colour 0 is held, so this takes it back
    expect(shared.giveBack[0]).toBe(0);
    give.clickToken(5);
    give.clickToken(5);
    give.clickToken(0);
    expect(give.giveTotal).toBe(2);
    expect(shared.giveBack).toEqual([0, 0, 0, 0, 0, 2]);
  });

  it('only offers the nobles you may choose', () => {
    const state = ref(makeState({ pending: { seat: 0, type: 'noble', options: ['n1'] } }));
    const { view, shared, send } = setup(state);
    const give = reactive(useTokenReturn(view, shared, send));
    expect(give.canPickNoble('n1')).toBe(true);
    expect(give.canPickNoble('n2')).toBe(false);
  });
});

describe('useEnding', () => {
  it('orders the standings by prestige then fewer cards, and explains a tie', () => {
    const state = ref(makeState({ phase: 'finished', winners: [1], hostSeat: 0, standings: [{ seat: 0, prestige: 15, cards: 9 }, { seat: 1, prestige: 15, cards: 7 }], endReason: 'limit' }));
    const { view } = setup(state);
    const ending = reactive(useEnding(view));
    expect(ending.standings.map((x) => x.name)).toEqual(['Bob', 'Ann']);
    expect(words(ending.tieNote)).toContain('fewer cards');
    expect(words(ending.endNote)).toContain('round limit');
    expect(ending.isHost).toBe(true);
    expect(ending.iWon).toBe(false);
  });
});
