// The words of the Splendour table: the Status box's headline and its lines, built from the game and the choice in progress.
import { computed } from 'vue';
import { MAX_TOKENS, NOBLE_POINTS } from '../rules.js';
import { GEM_NAMES } from './gems.js';

/**
 * Turns a payment into words, e.g. "2 Ruby and 1 Onyx".
 *
 * @param {number[]} pay  six counts
 * @returns {string} the words, or "nothing"
 */
export function payText(pay) {
  const parts = pay.flatMap((n, c) => (n > 0 ? [`${n} ${GEM_NAMES[c]}`] : []));
  if (!parts.length) return 'nothing';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * The banner and the Status box lines.
 *
 * @param {object} ctx  reactive parts of the table: view (useTableView), ending (useEnding), shared (choiceState), take
 *   (useGemTake) and card (useCardChoice)
 * @returns {object} banner, lastRound (strings) and statusLines (a list of strings or { text, tone })
 */
export function useStatusLines({ view, ending, shared, take, card }) {
  const banner = computed(() => {
    const { s, finished, myTurn, nameOf } = view;
    const { winners } = ending;
    if (finished) return winners.length === 1 ? `${winners[0].name}${winners[0].seat === s.you ? ' (you)' : ''} wins with ${winners[0].prestige} prestige!` : winners.length ? `A shared win: ${winners.map((w) => w.name).join(' and ')} with ${winners[0].prestige} prestige.` : 'The game is over.';
    const pending = s.pending;
    if (pending && pending.seat === s.you) return pending.type === 'return' ? `You have more than ${MAX_TOKENS} tokens: return ${pending.count}.` : 'Choose a noble: click the one you want in the market.';
    if (pending) return `${nameOf(pending.seat)} is ${pending.type === 'return' ? 'returning tokens' : 'choosing a noble'}.`;
    if (myTurn) return 'Your turn: take gems, reserve a card or buy a card.';
    return `Waiting for ${nameOf(s.turn)}…`;
  });
  const lastRound = computed(() => (view.s.finalRound && !view.finished ? `${view.nameOf(view.s.triggeredBy)} reached ${view.s.settings.target}: this is the last round, so everyone gets the same number of turns.` : ''));

  const statusLines = computed(() => {
    const lines = [];
    if (shared.message) lines.push({ text: shared.message, tone: 'warn' });
    if (lastRound.value) lines.push({ text: lastRound.value, tone: 'mine' });
    const pending = view.pendingMine;
    if (pending?.type === 'return') lines.push({ text: `You may hold only ${MAX_TOKENS} tokens. Click your own tokens to mark the ${pending.count} you want to give back, then press Return.`, tone: 'muted' });
    else if (pending?.type === 'noble') lines.push({ text: `Several nobles would like to visit you, but only one can. Click the highlighted noble you choose in the market (each is worth ${NOBLE_POINTS} prestige).`, tone: 'muted' });
    else if (view.finished) {
      if (ending.tieNote) lines.push({ text: ending.tieNote, tone: 'muted' });
      if (ending.endNote) lines.push({ text: ending.endNote, tone: 'muted' });
      if (ending.iWon) lines.push({ text: 'Well played.', tone: 'muted' });
    }
    else if (shared.sel?.kind === 'card') {
      const info = card.selectedInfo;
      lines.push({ text: `Level ${info.level} card: ${info.points} prestige, gives a ${GEM_NAMES[info.bonus]} bonus.`, tone: 'mine' });
      if (card.quote) {
        lines.push(`You can afford it. You would pay ${payText(card.payPlan)}${card.payPlan[5] ? ` (using ${card.payPlan[5]} Gold)` : ''}.`);
      } else {
        const short = card.missing.left.map((n, c) => (n > 0 ? [`${n} ${GEM_NAMES[c]}`] : [])).flat();
        lines.push({ text: `You cannot afford this yet: you are short of ${short.join(', ') || 'Gold'}${view.tokens[5] ? ` (your ${view.tokens[5]} Gold can cover ${Math.min(view.tokens[5], card.missing.total)})` : ''}.`, tone: 'warn' });
      }
      if (!view.myTurn && !view.pendingMine) lines.push({ text: view.s.pending ? 'Wait for the other player to finish.' : 'You can look at cards now, but can only act on your own turn.', tone: 'muted' });
    } else if (shared.sel?.kind === 'deck') {
      lines.push({ text: `Reserve from the level ${shared.sel.level} pile: you take the top card without seeing it first. Only you will know what it is until you buy it. ${card.goldLeft ? 'You also take 1 Gold.' : 'There is no Gold left, so you take none.'}`, tone: 'mine' });
    } else if (!pending) {
      lines.push({ text: take.takeCheck.text, tone: take.takeCheck.ok ? 'mine' : 'muted' });
      lines.push({ text: 'Click gems to take them, or click a card to buy or reserve it.', tone: 'muted' });
    }
    return lines;
  });

  return { banner, lastRound, statusLines };
}
