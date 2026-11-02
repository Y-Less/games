// Guided use of the tool cards: whether one can be used now, starting it, working out its request and sending it.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import { startMode } from './toolkit.js';

/**
 * The tool logic of the table.
 * @param {object} ctx  { s, turn, sel, send }: the view (computed), the useTurnState result, the useSelection result and the
 *   function that sends a request to the server and resolves with { ok, error }
 * @returns {object} toolBlock(tool), startTool(tool), toolParams, applyTool(extra), modeDie, modeSummary
 * Side effects: startTool and applyTool change the selection; applyTool sends a 'tool' request. Nothing is listened to.
 */
export function useTools({ s, turn, sel, send }) {
  const { me, myTurn, poolDie } = turn;
  const { selected, mode, message } = sel;
  const { t, error } = useGameText();

  /**
   * Why a tool cannot be used right now, or '' if it can (not your turn, one already used, not enough favour tokens...).
   * @param {{ cost: number }} tool  a tool card from the view
   * @returns {string} the reason in words, or ''
   * Side effects: none.
   */
  const toolBlock = (tool) => {
    if (s.value.phase !== 'playing') return t('errors.notPlaying');
    if (!myTurn.value) return t('errors.notYourTurn');
    if (s.value.turn.toolUsed) return t('errors.toolUsedAlready');
    if ((me.value?.tokens ?? 0) < tool.cost) return t('errors.notEnoughTokens', { count: tool.cost, have: me.value?.tokens ?? 0 }, tool.cost);
    return '';
  };

  /**
   * A tool card was clicked: begins guided use of it (clicking the same card again cancels). The server checks everything again.
   * @param {object} tool  a tool card from the view
   * @returns {void}
   * Side effects: clears and may set the Status message; sets or clears the tool in use and drops the selected die.
   */
  function startTool(tool) {
    message.value = '';
    const reason = toolBlock(tool);
    if (reason) return void (message.value = reason);
    if (mode.value?.id === tool.id) return void (mode.value = null);
    selected.value = null;
    mode.value = startMode(tool, me.value.window.grid);
  }

  /**
   * The request parameters the guided choices add up to so far, or null while something is still to be chosen.
   * @returns {object | null} for example { die }, { die, trackDie }, {} or { moves }
   * Side effects: none.
   */
  const toolParams = computed(() => {
    const m = mode.value;
    if (!m) return null;
    if (m.kind === 'pool') return m.die == null ? null : { die: m.die };
    if (m.kind === 'exchange') return m.die == null || m.trackDie == null ? null : { die: m.die, trackDie: m.trackDie };
    if (m.kind === 'confirm') return {};
    if (m.kind === 'moves') return m.moves.length >= m.min ? { moves: m.moves } : null;
    return null;
  });

  /**
   * Sends the tool being used. A failed slide resets the moves the player made, since the window on screen was only a preview.
   * @param {object} [extra]  parameters added by the button pressed (such as delta for Lathe)
   * @returns {Promise<void>} resolves when the server has answered
   * Side effects: sends a 'tool' request; on success ends the tool, on failure sets the Status message (and resets a slide's moves).
   */
  async function applyTool(extra = {}) {
    const m = mode.value;
    if (!m) return;
    const params = m.kind === 'moves' ? { moves: m.moves } : m.kind === 'delta' ? { die: m.die, ...extra } : { ...toolParams.value, ...extra };
    const reply = await send('tool', { tool: m.id, params });
    if (reply.ok) mode.value = null;
    else {
      message.value = error(reply);
      if (m.kind === 'moves') {
        m.moves = [];
        m.from = null;
        m.grid = me.value.window.grid;
      }
    }
  }

  /**
   * The pool die chosen for the tool being used, if any.
   * @returns {object | null} the die from the pool, or null
   * Side effects: none.
   */
  const modeDie = computed(() => (mode.value?.die == null ? null : poolDie(mode.value.die)));
  /**
   * A sentence saying how far the guided use of the tool has got (shown in Status).
   * @returns {string} the progress, or '' when no tool is in use
   * Side effects: none.
   */
  const modeSummary = computed(() => {
    const m = mode.value;
    if (!m) return '';
    if (m.kind === 'moves') {
      const total = m.min === m.max ? String(m.max) : t('tool.range', { min: m.min, max: m.max });
      return t(m.from !== null ? 'tool.movedNext' : 'tool.moved', { done: m.moves.length, total });
    }
    if (m.kind === 'exchange') {
      return t('tool.exchangeStep', { pool: t(m.die != null ? 'tool.poolChosen' : 'tool.choosePool'), track: t(m.trackDie != null ? 'tool.trackChosen' : 'tool.chooseTrack') });
    }
    if (m.kind === 'free') return t(m.die != null ? 'tool.freeSpace' : 'tool.choosePoolDie');
    if (m.kind === 'confirm') return t('tool.nothingMore');
    return t(m.die != null ? 'tool.dieChosen' : 'tool.chooseFromPool');
  });

  return { toolBlock, startTool, toolParams, applyTool, modeDie, modeSummary };
}
