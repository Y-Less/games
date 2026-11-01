// Choosing gems to take from the supply at the Splendour table, and sending the choice.
import { computed } from 'vue';
import { GEM_NAMES } from './gems.js';

/**
 * Gem taking.
 *
 * Side effects: clickGem changes the shared picks, sel and message; confirmTake sends 'take' or 'takeTwo' and clears the picks on success.
 *
 * @param {object} view    the table view (reactive)
 * @param {object} shared  the shared choice state (reactive)
 * @param {Function} send  sends an action to the server and resolves with its reply
 * @returns {object} available, isPair, takeCheck ({ ok, text }), clickGem(colour), confirmTake(), clearPicks()
 */
export function useGemTake(view, shared, send) {
  // Gem colours (0 to 4, not Gold) that still have tokens in the supply.
  const available = computed(() => [0, 1, 2, 3, 4].filter((c) => view.supply[c] > 0));
  // True when the picks are the same colour twice (a take of two of a kind).
  const isPair = computed(() => shared.picks.length === 2 && shared.picks[0] === shared.picks[1]);
  // Whether the current picks make a legal take ({ ok }) and the guidance or confirmation wording to show ({ text }).
  const takeCheck = computed(() => {
    const p = shared.picks;
    if (!available.value.length) return { ok: false, text: 'There are no gems left to take. Reserve or buy a card instead.' };
    if (!p.length) return { ok: false, text: 'Click three different gems, or one colour twice for two of a kind.' };
    if (isPair.value) return { ok: true, text: `Take two ${GEM_NAMES[p[0]]} gems.` };
    const need = available.value.length >= 3 ? 3 : 1;
    if (p.length < need) return { ok: false, text: `Pick ${need - p.length} more ${need - p.length === 1 ? 'gem' : 'gems'} of different colours.` };
    const more = Math.min(3, available.value.length) - p.length;
    return { ok: true, text: `Take ${p.map((c) => GEM_NAMES[c]).join(', ')}.${more > 0 ? ` (You could take ${more} more.)` : ''}` };
  });

  /**
   * Clicking a gem stack in the supply: add it to the picks, take it back out, or explain why not.
   *
   * @param {number} c  the gem colour (0 to 4)
   * @returns {void}
   * Side effects: sets the shared picks, clears sel, and sets or clears the shared message.
   */
  function clickGem(c) {
    shared.message = '';
    shared.sel = null;
    if (!view.turnIsMine || view.s.pending) {
      shared.message = view.s.pending ? 'Finish your current choice first.' : 'It is not your turn.';
      return;
    }
    const p = shared.picks;
    if (isPair.value) {
      shared.picks = c === p[0] ? [] : [c];
      return;
    }
    if (p.includes(c)) {
      if (p.length === 1 && view.supply[c] >= 4) shared.picks = [c, c];
      else if (p.length === 1 && available.value.length > 1) shared.message = `To take two ${GEM_NAMES[c]} gems, at least four must be left in the supply.`;
      else shared.picks = p.filter((x) => x !== c);
      return;
    }
    if (view.supply[c] < 1) {
      shared.message = `There are no ${GEM_NAMES[c]} gems left.`;
      return;
    }
    if (p.length >= 3) {
      shared.message = 'You can take at most three gems: click one to put it back first.';
      return;
    }
    shared.picks = [...p, c];
  }

  /**
   * Sends the chosen gems (a pair or up to three different ones); keeps the picks if the server refuses.
   * @returns {Promise<void>} resolves once the server has replied (does nothing if the picks are not a legal take or busy)
   * Side effects: sets the shared busy flag while waiting; sends 'takeTwo' or 'take'; clears picks on success.
   */
  async function confirmTake() {
    if (!takeCheck.value.ok || shared.busy) return;
    shared.busy = true;
    const reply = isPair.value ? await send('takeTwo', { colour: shared.picks[0] }) : await send('take', { colours: shared.picks });
    shared.busy = false;
    if (reply.ok) shared.picks = [];
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
