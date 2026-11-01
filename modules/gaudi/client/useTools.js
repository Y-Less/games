// Guided use of the tool cards: whether one can be used now, starting it, working out its request and sending it.
import { computed } from 'vue';
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

  /**
   * Why a tool cannot be used right now, or '' if it can (not your turn, one already used, not enough favour tokens...).
   * @param {{ cost: number }} tool  a tool card from the view
   * @returns {string} the reason in words, or ''
   * Side effects: none.
   */
  const toolBlock = (tool) => {
    if (s.value.phase !== 'playing') return 'The game is not being played.';
    if (!myTurn.value) return 'Not your turn.';
    if (s.value.turn.toolUsed) return 'You have already used a tool this turn.';
    if ((me.value?.tokens ?? 0) < tool.cost) return `You need ${tool.cost} favour ${tool.cost === 1 ? 'token' : 'tokens'}; you have ${me.value?.tokens ?? 0}.`;
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
      message.value = reply.error;
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
    if (m.kind === 'moves') return `${m.moves.length} of ${m.min === m.max ? m.max : `${m.min} to ${m.max}`} dice moved${m.from !== null ? '; now click where it goes' : ''}.`;
    if (m.kind === 'exchange') return `${m.die != null ? 'Pool die chosen' : 'Choose a pool die'}; ${m.trackDie != null ? 'track die chosen' : 'now a die on the round track'}.`;
    if (m.kind === 'free') return m.die != null ? 'Now click the space for it.' : 'Choose a pool die.';
    if (m.kind === 'confirm') return 'Nothing more to choose.';
    return m.die != null ? 'Die chosen.' : 'Choose a die in the pool.';
  });

  return { toolBlock, startTool, toolParams, applyTool, modeDie, modeSummary };
}
