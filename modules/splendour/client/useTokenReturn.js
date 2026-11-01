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
  // How many tokens are currently marked for return.
  const giveTotal = computed(() => sum(shared.giveBack));
  // True when the server is waiting for you to pick a noble.
  const choosingNoble = computed(() => view.pendingMine?.type === 'noble');

  /**
   * Whether this noble is one of the choices on offer to you.
   *
   * @param {string} id  a noble id
   * @returns {boolean} true when you are choosing and this noble is an option
   * Side effects: none.
   */
  const canPickNoble = (id) => Boolean(choosingNoble.value && view.pendingMine.options.includes(id));

  /**
   * Marks one more token of a colour for return, within what you hold and what you must give back.
   *
   * @param {number} c  the token colour (0 to 5, 5 being Gold)
   * @returns {void}
   * Side effects: replaces the shared giveBack (unless the mark is not allowed, when nothing changes).
   */
  function addGive(c) {
    if (!view.pendingMine || shared.giveBack[c] >= view.tokens[c] || giveTotal.value >= view.pendingMine.count) return;
    shared.giveBack = shared.giveBack.map((n, i) => (i === c ? n + 1 : n));
  }
  /**
   * Unmarks one token of a colour.
   *
   * @param {number} c  the token colour
   * @returns {void}
   * Side effects: replaces the shared giveBack.
   */
  function removeGive(c) {
    if (shared.giveBack[c] > 0) shared.giveBack = shared.giveBack.map((n, i) => (i === c ? n - 1 : n));
  }
  /**
   * Clicking one of your own tokens while returning: mark one more for return, or (when no more can be marked) take one back.
   *
   * @param {number} c  the token colour
   * @returns {void}
   * Side effects: replaces the shared giveBack via addGive or removeGive.
   */
  function clickToken(c) {
    if (!view.pendingMine) return;
    const full = shared.giveBack[c] >= view.tokens[c] || giveTotal.value >= view.pendingMine.count;
    if (!full) addGive(c);
    else removeGive(c);
  }
  /**
   * Unmarks every token.
   * @returns {void}
   * Side effects: resets the shared giveBack to zeros.
   */
  function clear() {
    shared.giveBack = noTokens();
  }
  /**
   * Sends the tokens marked for return once exactly the right number is marked.
   * @returns {Promise<void>} resolves once the server has replied (does nothing if the count is wrong or busy)
   * Side effects: sets the shared busy flag while waiting; sends 'giveBack'; clears the marks on success.
   */
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
   * Side effects: sends a 'noble' request to the server.
   */
  const chooseNoble = (noble) => send('noble', { noble });

  return { giveTotal, choosingNoble, canPickNoble, addGive, removeGive, clickToken, clear, confirmGive, chooseNoble };
}
