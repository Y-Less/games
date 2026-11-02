// What your window and the pool show and do when clicked: the highlighted spaces, clicking a pool die, a track die or a
// space (a placement, Free Pane, or the moves of a slide tool).  The rules themselves live in ../rules.js.
import { computed } from 'vue';
import { CELLS, cellProblem, moveProblem } from '../rules.js';
import { useGameText } from '../../../src/useGameText.js';

/**
 * The click handling of the table.
 * @param {object} ctx  { s, turn, sel, applyTool, send }: the view (computed), the useTurnState and useSelection results,
 *   useTools' applyTool, and the function that sends a request to the server
 * @returns {object} myGrid, highlight, clickPool(die), clickTrack(die), clickCell(index)
 * Side effects: the click handlers change the selection and message; clickCell sends 'place' or 'tool' requests.
 */
export function useBoardClicks({ s, turn, sel, applyTool, send }) {
  const { me, myTurn, canPlace, pattern, nameOf, poolDie, emptyGrid } = turn;
  const { selected, mode, message } = sel;
  const { t, text, error } = useGameText();
  // Whoever the table is waiting for, for the line shown when you click too early.
  const notYours = () => t('errors.othersTurn', { name: nameOf(s.value.turn?.seat) });

  /**
   * The window shown as yours: the preview of a slide tool when one is in use, otherwise the real one.
   * @returns {(object | null)[]} CELLS dice or nulls
   * Side effects: none.
   */
  const myGrid = computed(() => mode.value?.grid ?? me.value?.window?.grid ?? emptyGrid());

  /**
   * Which spaces of your window to mark for what you are doing now: spaces a chosen die may go on (with the reason on the
   * others as a hover title), dice a slide tool can pick up, and where a picked-up die may go.
   * @returns {{ legal: number[], pick: number[], chosen: number[], titles: Record<number, string> }}
   * Side effects: none (computed; recalculates when the view, selection, or tool changes).
   */
  const highlight = computed(() => {
    const out = { legal: [], pick: [], chosen: [], titles: {} };
    if (!myTurn.value || !pattern.value) return out;
    const grid = myGrid.value;
    const m = mode.value;
    if (m?.kind === 'moves') {
      if (m.from === null) {
        const colour = m.sameColour && m.moves.length ? grid[m.moves[0].to]?.c : null;
        grid.forEach((d, i) => {
          if (d && !m.moves.some((mv) => mv.to === i) && (!colour || d.c === colour)) out.pick.push(i);
        });
      } else {
        out.chosen.push(m.from);
        for (let i = 0; i < CELLS; i++) {
          const problem = moveProblem(grid, pattern.value, m.from, i, m.options);
          if (problem === null) out.legal.push(i);
          else out.titles[i] = text(problem);
        }
      }
      return out;
    }
    const dieId = m?.kind === 'free' ? m.die : m ? null : selected.value;
    const die = dieId == null ? null : poolDie(dieId);
    if (die && (m?.kind === 'free' || canPlace.value)) {
      for (let i = 0; i < CELLS; i++) {
        const problem = cellProblem(grid, pattern.value, i, die, m?.options ?? {});
        if (problem === null) out.legal.push(i);
        else out.titles[i] = text(problem);
      }
    }
    return out;
  });

  /**
   * A die in the pool was clicked: it is chosen for the tool being used, or selected for placing (clicking it again clears it).
   * Writes a reason in the Status box when it cannot be used now.
   * @param {{ id: number }} die  the pool die that was clicked
   * @returns {void}
   * Side effects: clears and may set the Status message; may change the tool's chosen die or the selected die.
   */
  function clickPool(die) {
    message.value = '';
    const m = mode.value;
    if (m) {
      if (['delta', 'pool', 'exchange', 'free'].includes(m.kind)) m.die = m.die === die.id ? null : die.id;
      else message.value = t('errors.toolNoPoolDie');
      return;
    }
    if (!myTurn.value) return void (message.value = notYours());
    if (!canPlace.value) return void (message.value = t('errors.alreadyPlaced'));
    selected.value = selected.value === die.id ? null : die.id;
  }

  /**
   * A die on the round track was clicked: only Exchange uses it (clicking it again clears it).
   * @param {{ id: number }} die  the round-track die that was clicked
   * @returns {void}
   * Side effects: toggles trackDie on the tool in use; does nothing for any other tool.
   */
  function clickTrack(die) {
    if (mode.value?.kind !== 'exchange') return;
    mode.value.trackDie = mode.value.trackDie === die.id ? null : die.id;
  }

  /**
   * A space of your window was clicked: it is part of a slide tool, or the place for the selected pool die (a plain placement,
   * or Free Pane).  Checks the rule on the screen first so that the player is told why, then asks the server.
   * @param {number} index  the space, 0 to CELLS - 1
   * @returns {Promise<void>} resolves when the request (if any) has been answered
   * Side effects: clears and may set the Status message; may send 'place' or 'tool'; on success clears the selection and tool.
   */
  async function clickCell(index) {
    message.value = '';
    if (!myTurn.value) return void (message.value = notYours());
    const m = mode.value;
    if (m?.kind === 'moves') return clickMoveCell(m, index);
    const dieId = m?.kind === 'free' ? m.die : m ? null : selected.value;
    if (m && m.kind !== 'free') return void (message.value = t(`tools.${m.id}.how`));
    const die = dieId == null ? null : poolDie(dieId);
    if (!die) return void (message.value = t(canPlace.value || m ? 'errors.choosePoolFirst' : 'errors.alreadyPlaced'));
    const problem = cellProblem(myGrid.value, pattern.value, index, die, m?.options ?? {});
    if (problem) return void (message.value = text(problem));
    const reply = m ? await send('tool', { tool: m.id, params: { die: die.id, cell: index } }) : await send('place', { die: die.id, cell: index });
    if (reply.ok) {
      selected.value = null;
      mode.value = null;
    } else message.value = error(reply);
  }

  /**
   * A space was clicked while a slide tool is in use: first the die to move, then where it goes.  When the tool has all the
   * moves it needs, the request is sent.
   * @param {object} m      the tool state from startMode (mutated: from, moves, grid)
   * @param {number} index  the space
   * @returns {void}
   * Side effects: mutates m (from, moves, grid), may set the Status message and may call applyTool (which sends 'tool').
   */
  function clickMoveCell(m, index) {
    const grid = m.grid;
    if (m.from === null) {
      if (!grid[index]) return void (message.value = t('errors.clickDieFirst'));
      if (m.moves.some((mv) => mv.to === index)) return void (message.value = t('errors.dieAlreadyMoved'));
      const first = m.moves.length ? grid[m.moves[0].to] : null;
      if (m.sameColour && first && grid[index].c !== first.c) return void (message.value = t('errors.secondDieColour', { colour: t(`colours.${first.c}`) }));
      m.from = index;
      return;
    }
    if (index === m.from) {
      m.from = null;
      return;
    }
    const problem = moveProblem(grid, pattern.value, m.from, index, m.options);
    if (problem) return void (message.value = text(problem));
    const next = grid.slice();
    next[index] = next[m.from];
    next[m.from] = null;
    m.moves.push({ from: m.from, to: index });
    m.grid = next;
    m.from = null;
    if (m.moves.length >= m.max) applyTool();
  }

  return { myGrid, highlight, clickPool, clickTrack, clickCell };
}
