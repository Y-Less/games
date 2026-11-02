// The words in the Status box: the headline and every line below it, for the phase the game is in.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import { privateRule } from './wording.js';

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
  const { t, list } = useGameText();
  // Your secret colour's name, for the two lines that mention it (only called when you have a private objective).
  const myColour = () => t(`colours.${s.value.privateObjective.colour}`);

  /**
   * The headline in the Status box: what is happening and what you may do.
   * @returns {string} one sentence, which depends on the phase and on whose turn it is
   * Side effects: none.
   */
  const status = computed(() => {
    if (finished.value) return t('status.over');
    if (windows.value) {
      if (!s.value.chosen) return t('status.chooseWindow');
      return t('status.chosenWaiting', { names: waitingFor.value.length ? list(waitingFor.value) : t('status.theOthers') });
    }
    if (!myTurn.value) return t('status.waitingFor', { name: nameOf(s.value.turn?.seat) });
    const now = s.value.turn;
    const die = t(now.placements < now.allowed ? 'status.diePlace' : 'status.diePlaced');
    const tool = t(now.toolUsed ? 'status.toolUsed' : 'status.toolMay');
    return t(now.extra ? 'status.turnExtra' : turnNumber.value === 'second' ? 'status.turnSecond' : 'status.turnFirst', { die, tool });
  });
  /**
   * A reminder when you are about to end your turn without having placed a die.
   * @returns {string} the reminder, or '' when it does not apply
   * Side effects: none.
   */
  const endHint = computed(() => (myTurn.value && s.value.turn.placements === 0 && s.value.pool.length ? t('status.notPlaced') : ''));
  // How your private colour is scored, shared by two of the lines below.
  const myPrivateRule = computed(() => privateRule(t, s.value.badPrivate));
  /**
   * Every line of the Status box, with its tone, for the phase the game is in.
   * @returns {{ text: string, tone: string }[]} tone is 'warn', 'mine' or 'muted', and only picks the colour
   * Side effects: none.
   */
  const statusLines = computed(() => {
    const lines = [];
    if (message.value) lines.push({ text: message.value, tone: 'warn' });
    if (windows.value) {
      if (s.value.privateObjective) lines.push({ text: t('status.privateWindows', { colour: myColour(), rule: myPrivateRule.value }), tone: 'mine' });
      if (hint.value) lines.push({ text: hint.value, tone: 'muted' });
      lines.push({ text: t('status.chooseInfo'), tone: 'muted' });
      lines.push({ text: s.value.seats.filter(Boolean).map((seat) => t(seat.picked ? 'status.seatChosen' : 'status.seatChoosing', { name: seat.name })).join(' · '), tone: 'muted' });
      return lines;
    }
    if (mode.value) {
      const cost = mode.value.cost;
      lines.push({ text: t('status.toolInUse', { name: t(`tools.${mode.value.id}.name`), count: cost, how: t(`tools.${mode.value.id}.how`) }, cost), tone: 'mine' });
      lines.push({ text: tools.modeSummary.value, tone: 'muted' });
    } else if (hint.value) lines.push({ text: hint.value, tone: 'muted' });
    else if (myTurn.value) lines.push({ text: t('status.clickDie'), tone: 'muted' });
    if (myTurn.value && s.value.turn.extra) lines.push({ text: t('status.extraTurn'), tone: 'mine' });
    else if (myTurn.value && s.value.turn.swift) lines.push({ text: t('status.swiftActive'), tone: 'mine' });
    if (endHint.value && !mode.value) lines.push({ text: endHint.value, tone: 'muted' });
    if (myTurn.value && s.value.turn.canUndo) lines.push({ text: t('status.undoHint'), tone: 'muted' });
    if (!finished.value) {
      const empty = me.value?.empty ?? 0;
      lines.push({ text: t('status.yourWindow', { count: empty, score: me.value?.score }, empty), tone: 'muted' });
      lines.push({ text: t('status.provisional'), tone: 'muted' });
      if (s.value.privateObjective) lines.push({ text: t('status.privatePlaying', { colour: myColour(), points: s.value.privateObjective.points, rule: myPrivateRule.value }), tone: 'muted' });
    }
    return lines;
  });

  return { status, statusLines };
}
