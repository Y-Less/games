// The words in the Status box: the headline and every line below it, for the phase the game is in.
import { computed } from 'vue';
import { colourName, privateRule } from './wording.js';

/**
 * Builds the Status box text.
 * @param {object} ctx  { s, turn, sel, tools, hint }: the view (computed), the useTurnState, useSelection and useTools
 *   results, and the ref holding what the pointer is over
 * @returns {{ status: import('vue').ComputedRef<string>, statusLines: import('vue').ComputedRef<object[]> }}
 *   status is the headline, statusLines the further lines as { text, tone }
 * Side effects: none (computed values only).
 */
export function useStatusText({ s, turn, sel, tools, hint }) {
  const { windows, finished, me, myTurn, waitingFor, turnNumber, nameOf } = turn;
  const { mode, message } = sel;

  /**
   * The headline in the Status box: what is happening and what you may do.
   * @returns {string} one sentence, which depends on the phase and on whose turn it is
   * Side effects: none.
   */
  const status = computed(() => {
    if (finished.value) return 'The game is over.';
    if (windows.value) return s.value.chosen ? `You have chosen. Waiting for ${waitingFor.value.join(', ') || 'the others'}…` : 'Choose your window.';
    if (!myTurn.value) return `Waiting for ${nameOf(s.value.turn?.seat)}…`;
    const t = s.value.turn;
    const die = t.placements < t.allowed ? 'place a die' : 'your die is placed';
    const tool = t.toolUsed ? 'your tool is used' : 'you may use a tool';
    return `Your ${t.extra ? 'extra' : turnNumber.value} turn: ${die}; ${tool}. Click End turn when you are happy.`;
  });
  /**
   * A reminder when you are about to end your turn without having placed a die.
   * @returns {string} the reminder, or '' when it does not apply
   * Side effects: none.
   */
  const endHint = computed(() => (myTurn.value && s.value.turn.placements === 0 && s.value.pool.length ? 'You have not placed a die yet.' : ''));
  // How your private colour is scored, shared by two of the lines below.
  const myPrivateRule = computed(() => privateRule(s.value.badPrivate));
  /**
   * Every line of the Status box, with its tone, for the phase the game is in.
   * @returns {{ text: string, tone: string }[]} tone is 'warn', 'mine' or 'muted' and only picks the colour
   * Side effects: none.
   */
  const statusLines = computed(() => {
    const lines = [];
    if (message.value) lines.push({ text: message.value, tone: 'warn' });
    if (windows.value) {
      if (s.value.privateObjective) lines.push({ text: `Your private objective is ${colourName(s.value.privateObjective.colour)}. ${myPrivateRule.value} Only you can see it until the end.`, tone: 'mine' });
      if (hint.value) lines.push({ text: hint.value, tone: 'muted' });
      lines.push({ text: "Everyone chooses at the same time, and nobody sees the others' choices until all are in. A harder window gives more favour tokens.", tone: 'muted' });
      lines.push({ text: s.value.seats.filter(Boolean).map((seat) => `${seat.name}: ${seat.picked ? 'has chosen' : 'choosing…'}`).join(' · '), tone: 'muted' });
      return lines;
    }
    if (mode.value) {
      lines.push({ text: `${mode.value.name} (costs ${mode.value.cost} favour ${mode.value.cost === 1 ? 'token' : 'tokens'}): ${mode.value.how}`, tone: 'mine' });
      lines.push({ text: tools.modeSummary.value, tone: 'muted' });
    } else if (hint.value) lines.push({ text: hint.value, tone: 'muted' });
    else if (myTurn.value) lines.push({ text: 'Click a die in the pool, then a highlighted space in your window.', tone: 'muted' });
    if (myTurn.value && s.value.turn.extra) lines.push({ text: 'Extra turn (Swift Hand): a whole new turn, so choose another die and use more favour tokens if you wish. Your second turn of the round is skipped.', tone: 'mine' });
    else if (myTurn.value && s.value.turn.swift) lines.push({ text: 'Swift Hand is active: when you end this turn you take an extra turn straight away, and your second turn of the round is skipped.', tone: 'mine' });
    if (endHint.value && !mode.value) lines.push({ text: endHint.value, tone: 'muted' });
    if (myTurn.value && s.value.turn.canUndo) lines.push({ text: 'You can change your mind until you click End turn: Undo turn takes this whole turn back.', tone: 'muted' });
    if (!finished.value) {
      lines.push({ text: `Your window: ${me.value?.empty} empty ${me.value?.empty === 1 ? 'space' : 'spaces'}, provisional score ${me.value?.score}.`, tone: 'muted' });
      lines.push({ text: 'Scores are provisional until the end: private objectives are not counted yet.', tone: 'muted' });
      if (s.value.privateObjective) lines.push({ text: `Your private objective, ${colourName(s.value.privateObjective.colour)} (${s.value.privateObjective.points} points so far): ${myPrivateRule.value} Only you can see it until the end.`, tone: 'muted' });
    }
    return lines;
  });

  return { status, statusLines };
}
