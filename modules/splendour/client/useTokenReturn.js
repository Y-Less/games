// Returning tokens (when over the limit) and choosing a noble at the Splendour table: the two choices the server can ask
// of you between turns.
import { computed } from 'vue';
import { noTokens } from './choiceState.js';
import { sum } from './tableView.js';

/**
 * Token return and noble choice.
 *
 * Side effects: addGive, removeGive, clickToken and clear change the shared giveBack; confirmGive sends 'giveBack' and
 * clears it on success; chooseNoble sends 'noble'.
 *
 * @param {object} view    the table view (reactive)
 * @param {object} shared  the shared choice state (reactive)
 * @param {Function} send  sends an action to the server and resolves with its reply
 * @returns {object} giveTotal, choosingNoble, canPickNoble(id), addGive(c), removeGive(c), clickToken(c), clear(), confirmGive(), chooseNoble(id)
 */
export function useTokenReturn(view, shared, send) {
  const giveTotal = computed(() => sum(shared.giveBack));
  const choosingNoble = computed(() => view.pendingMine?.type === 'noble');

  /**
   * Whether this noble is one of the choices on offer to you.
   *
   * @param {string} id  a noble id
   * @returns {boolean} true when you are choosing and this noble is an option
   */
  const canPickNoble = (id) => Boolean(choosingNoble.value && view.pendingMine.options.includes(id));

  /**
   * Marks one more token of a colour for return, within what you hold and what you must give back.
   *
   * @param {number} c  the token colour (0 to 5, 5 being Gold)
   */
  function addGive(c) {
    if (!view.pendingMine || shared.giveBack[c] >= view.tokens[c] || giveTotal.value >= view.pendingMine.count) return;
    shared.giveBack = shared.giveBack.map((n, i) => (i === c ? n + 1 : n));
  }
  /**
   * Unmarks one token of a colour.
   *
   * @param {number} c  the token colour
   */
  function removeGive(c) {
    if (shared.giveBack[c] > 0) shared.giveBack = shared.giveBack.map((n, i) => (i === c ? n - 1 : n));
  }
  /**
   * Clicking one of your own tokens while returning: mark one more for return, or (when no more can be marked) take one back.
   *
   * @param {number} c  the token colour
   */
  function clickToken(c) {
    if (!view.pendingMine) return;
    const full = shared.giveBack[c] >= view.tokens[c] || giveTotal.value >= view.pendingMine.count;
    if (!full) addGive(c);
    else removeGive(c);
  }
  /** Unmarks every token. */
  function clear() {
    shared.giveBack = noTokens();
  }
  /** Sends the tokens marked for return once exactly the right number is marked. */
  async function confirmGive() {
    if (!view.pendingMine || giveTotal.value !== view.pendingMine.count || shared.busy) return;
    shared.busy = true;
    const reply = await send('giveBack', { tokens: shared.giveBack });
    shared.busy = false;
    if (reply.ok) clear();
  }
  /**
   * Chooses a noble.
   *
   * @param {string} noble  a noble id
   * @returns {Promise} the server's reply
   */
  const chooseNoble = (noble) => send('noble', { noble });

  return { giveTotal, choosingNoble, canPickNoble, addGive, removeGive, clickToken, clear, confirmGive, chooseNoble };
}
