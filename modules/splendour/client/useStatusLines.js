// The words of the Splendour table: the Status box's headline and its lines.  Nothing here is English: each line is a
// message (`{ key, params }`, see shared/messages.js) that Table.vue puts into the player's language with `text()`.
import { computed } from 'vue';
import { msg } from '../../../shared/messages.js';
import { MAX_TOKENS, NOBLE_POINTS } from '../rules.js';
import { gemCountMsg, gemMsg } from './gems.js';

/**
 * A payment as a list of messages, e.g. "2 Ruby and 1 Onyx" once the table joins them.
 *
 * @param {number[]} pay  six counts, one per colour with Gold last
 * @returns {object | object[]} the parts as messages, or the message for "nothing"
 * Side effects: none.
 */
export function payParts(pay) {
  const parts = pay.flatMap((n, c) => (n > 0 ? [gemCountMsg(n, c)] : []));
  return parts.length ? parts : msg('facts.nothing');
}

/**
 * The banner and the Status box lines.
 *
 * @param {object} ctx  reactive parts of the table: view (useTableView), ending (useEnding), shared (choiceState), take
 *   (useGemTake), and card (useCardChoice)
 * @returns {object} banner, lastRound (messages, or null), and statusLines (a list of { text, tone } whose `text` is a message)
 *
 * Side effects: none (creates computed values only).
 */
export function useStatusLines({ view, ending, shared, take, card }) {
  // The one-line headline for the Status box: the result, a pending choice, or whose turn it is.
  const banner = computed(() => {
    const { s, finished, myTurn, nameOf } = view;
    const { winners } = ending;
    if (finished) {
      if (!winners.length) return msg('status.gameOver');
      if (winners.length > 1) return msg('status.sharedWin', { names: winners.map((w) => w.name), prestige: winners[0].prestige });
      return msg(winners[0].seat === s.you ? 'status.winnerYou' : 'status.winner', { name: winners[0].name, prestige: winners[0].prestige });
    }
    const pending = s.pending;
    if (pending && pending.seat === s.you) return pending.type === 'return' ? msg('status.returnTokens', { max: MAX_TOKENS, count: pending.count }) : msg('status.chooseNoble');
    if (pending) return msg(pending.type === 'return' ? 'status.theirReturn' : 'status.theirNoble', { name: nameOf(pending.seat) });
    if (myTurn) return msg('status.myTurn');
    return msg('status.waitingFor', { name: nameOf(s.turn) });
  });
  // A note that the final round has begun and why (null otherwise).
  const lastRound = computed(() => (view.s.finalRound && !view.finished ? msg('status.lastRound', { name: view.nameOf(view.s.triggeredBy), target: view.s.settings.target }) : null));

  // The Status box lines, in order of importance: warning, last-round note, then what is selected or what to do next.
  const statusLines = computed(() => {
    const lines = [];
    if (shared.message) lines.push({ text: shared.message, tone: 'warn' });
    if (lastRound.value) lines.push({ text: lastRound.value, tone: 'mine' });
    const pending = view.pendingMine;
    if (pending?.type === 'return') lines.push({ text: msg('status.returnHelp', { max: MAX_TOKENS, count: pending.count }), tone: 'muted' });
    else if (pending?.type === 'noble') lines.push({ text: msg('status.nobleHelp', { points: NOBLE_POINTS }), tone: 'muted' });
    else if (view.finished) {
      if (ending.tieNote) lines.push({ text: ending.tieNote, tone: 'muted' });
      if (ending.endNote) lines.push({ text: ending.endNote, tone: 'muted' });
      if (ending.iWon) lines.push({ text: msg('status.wellPlayed'), tone: 'muted' });
    }
    else if (shared.sel?.kind === 'card') {
      const info = card.selectedInfo;
      lines.push({ text: msg('status.cardInfo', { level: info.level, points: info.points, bonus: gemMsg(info.bonus) }), tone: 'mine' });
      if (card.quote) {
        const pay = payParts(card.payPlan);
        lines.push({ text: card.payPlan[5] ? msg('status.affordGold', { pay, gold: card.payPlan[5] }) : msg('status.afford', { pay }), tone: '' });
      } else {
        const parts = card.missing.left.flatMap((n, c) => (n > 0 ? [gemCountMsg(n, c)] : []));
        const short = parts.length ? parts : [gemMsg(5)];
        const gold = view.tokens[5];
        lines.push({ text: gold ? msg('status.shortGold', { short, gold, covered: Math.min(gold, card.missing.total) }) : msg('status.short', { short }), tone: 'warn' });
      }
      if (!view.myTurn && !view.pendingMine) lines.push({ text: msg(view.s.pending ? 'status.waitOther' : 'status.lookOnly'), tone: 'muted' });
    } else if (shared.sel?.kind === 'deck') {
      lines.push({ text: msg(card.goldLeft ? 'status.reserveBlind' : 'status.reserveBlindNoGold', { level: shared.sel.level }), tone: 'mine' });
    } else if (!pending) {
      lines.push({ text: take.takeCheck.text, tone: take.takeCheck.ok ? 'mine' : 'muted' });
      lines.push({ text: msg('status.hint'), tone: 'muted' });
    }
    return lines;
  });

  return { banner, lastRound, statusLines };
}
