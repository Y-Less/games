// Choosing gems to take from the supply at the Splendour table, and sending the choice.  Everything it says is a message
// (`{ key, params }`, see shared/messages.js) that the table puts into the player's language with `text()`.
import { computed } from 'vue';
import { msg } from '../../../shared/messages.js';
import { useSend } from './choiceState.js';
import { gemMsg } from './gems.js';

/**
 * What clicking a gem stack means, as a decision rather than as a change: either the picks it leaves, or the reason
 * it leaves them alone.  Written apart from the composable because it is the rule of the game at this table — two of
 * a kind need four in the stack, three different ones at most, an empty stack is not a pick — and a rule is easier to
 * trust when it can be read, and tested, without a table around it.
 *
 * @param {number} c  the gem colour clicked (0 to 4)
 * @param {object} state  { picks, isPair, supply, available }
 * @returns {{ picks: number[] } | { message: object }} the new picks, or what to say instead
 * Side effects: none.
 */
export function gemClick(c, { picks, isPair, supply, available }) {
  if (isPair) return { picks: c === picks[0] ? [] : [c] };
  if (picks.includes(c)) {
    if (picks.length === 1 && supply[c] >= 4) return { picks: [c, c] };
    if (picks.length === 1 && available.length > 1) return { message: msg('take.pairNeedsFour', { gem: gemMsg(c) }) };
    return { picks: picks.filter((x) => x !== c) };
  }
  if (supply[c] < 1) return { message: msg('take.noneOfColour', { gem: gemMsg(c) }) };
  if (picks.length >= 3) return { message: msg('take.atMostThree') };
  return { picks: [...picks, c] };
}

/**
 * Gem taking.
 *
 * Side effects: clickGem changes the shared picks, sel, and message; confirmTake sends 'take' or 'takeTwo' and clears the picks on success.
 *
 * @param {object} view    the table view (reactive)
 * @param {object} shared  the shared choice state (reactive)
 * @param {Function} send  sends an action to the server and resolves with its reply
 * @returns {object} available, isPair, takeCheck ({ ok, text }, where `text` is a message), clickGem(colour), confirmTake(), clearPicks()
 */
export function useGemTake(view, shared, send) {
  const request = useSend(shared, send);
  // Gem colours (0 to 4, not Gold) that still have tokens in the supply.
  const available = computed(() => [0, 1, 2, 3, 4].filter((c) => view.supply[c] > 0));
  // True when the picks are the same colour twice (a take of two of a kind).
  const isPair = computed(() => shared.picks.length === 2 && shared.picks[0] === shared.picks[1]);
  // Whether the current picks make a legal take ({ ok }) and the guidance or confirmation to show ({ text }, a message).
  const takeCheck = computed(() => {
    const p = shared.picks;
    if (!available.value.length) return { ok: false, text: msg('take.noneLeft') };
    if (!p.length) return { ok: false, text: msg('take.howTo') };
    if (isPair.value) return { ok: true, text: msg('take.pair', { gem: gemMsg(p[0]) }) };
    const need = available.value.length >= 3 ? 3 : 1;
    if (p.length < need) return { ok: false, text: msg('take.more', { count: need - p.length }) };
    const more = Math.min(3, available.value.length) - p.length;
    const gems = p.map((c) => gemMsg(c));
    return { ok: true, text: more > 0 ? msg('take.confirmMore', { gems, count: more }) : msg('take.confirm', { gems }) };
  });

  /**
   * Clicking a gem stack in the supply: add it to the picks, take it back out, or explain why not.
   *
   * @param {number} c  the gem colour (0 to 4)
   * @returns {void}
   * Side effects: sets the shared picks, clears sel, and sets or clears the shared message.
   */
  function clickGem(c) {
    shared.message = null;
    shared.sel = null;
    if (!view.turnIsMine || view.s.pending) {
      shared.message = view.s.pending ? msg('status.finishFirst') : msg('errors.notYourTurn');
      return;
    }
    const outcome = gemClick(c, { picks: shared.picks, isPair: isPair.value, supply: view.supply, available: available.value });
    if (outcome.picks) shared.picks = outcome.picks;
    else shared.message = outcome.message;
  }

  /**
   * Sends the chosen gems (a pair or up to three different ones); keeps the picks if the server refuses.
   * @returns {Promise<void>} resolves once the server has replied (does nothing if the picks are not a legal take or busy)
   * Side effects: sets the shared busy flag while waiting; sends 'takeTwo' or 'take'; clears picks on success.
   */
  async function confirmTake() {
    if (!takeCheck.value.ok) return;
    const [action, payload] = isPair.value ? ['takeTwo', { colour: shared.picks[0] }] : ['take', { colours: shared.picks }];
    await request(action, payload, clearPicks);
  }

  /**
   * Forgets the chosen gems.
   * @returns {void}
   * Side effects: clears the shared picks.
   */
  function clearPicks() {
    shared.picks = [];
  }

  return { available, isPair, takeCheck, clickGem, confirmTake, clearPicks };
}
