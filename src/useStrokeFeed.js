// The client half of a drawing that is not part of the view.  A drawing is thousands of instructions a turn, so the
// server relays them as they are made (`draw`) and sends a whole board to anybody who arrives, or comes back, in the
// middle of a turn (`canvas`): see shared/strokeRelay.js for the server half.  This listens for both, hands the
// strokes to the board they belong to, and asks for the boards again whenever they may have gone stale - on mounting,
// on a new turn, and every time the socket reconnects, since strokes relayed while it was down were never received.
// Shared by the games that draw (Scribblers, Draw!).
// Depends on: Vue only.
import { onBeforeUnmount, onMounted, watch } from 'vue';

/**
 * Keeps this viewer's boards in step with the server's.
 *
 * @param {object} options
 * @param {object} options.socket  the module's socket, which the stroke events arrive on
 * @param {(event: string, payload?: object) => *} options.send  sends a request to the server
 * @param {() => Array<{ apply: Function, reset: Function } | null | undefined>} options.boards  the board components
 *   (src/components/DrawingBoard.vue), in the order the server numbers them.  A game with one board gives a list of
 *   one, and its messages need not say which.
 * @param {() => *} options.turnKey  names the turn the boards belong to; when it changes they are blanked and asked
 *   for afresh
 * @param {() => boolean} [options.wanted]  whether there is anything worth asking for now (default: always)
 * @returns {{ ask: () => void }} `ask` requests the boards as they stand
 * Side effects: listens for `draw`, `canvas`, and `connect` on the socket while the component is mounted; sends
 * `canvas` requests; draws on the boards.
 */
export function useStrokeFeed({ socket, send, boards, turnKey, wanted = () => true }) {
  /** The board a message is for (the first, when the message does not say). */
  const boardOf = (message) => boards()[message?.board ?? 0] ?? null;

  /**
   * Draws instructions somebody else has made.
   * @param {{ board?: number, ops: object[] }} message  what the server relayed
   * @returns {void}
   * Side effects: draws on one of the boards.
   */
  const onDraw = (message) => boardOf(message)?.apply(message?.ops ?? []);

  /**
   * A board as it now stands, in chunks: the first chunk starts it afresh, the rest are added to it.
   * @param {{ board?: number, ops: object[], first: boolean }} message  one chunk
   * @returns {void}
   * Side effects: redraws or adds to one of the boards.
   */
  const onCanvas = (message) => {
    const board = boardOf(message);
    if (!board) return;
    if (message?.first) board.reset(message.ops ?? []);
    else board.apply(message?.ops ?? []);
  };

  /**
   * Asks the server for the boards as they stand.
   * @returns {void}
   * Side effects: sends a 'canvas' request.
   */
  const ask = () => {
    if (wanted()) send('canvas');
  };

  onMounted(() => {
    socket.on('draw', onDraw);
    socket.on('canvas', onCanvas);
    socket.on('connect', ask);
    ask();
  });
  onBeforeUnmount(() => {
    socket.off('draw', onDraw);
    socket.off('canvas', onCanvas);
    socket.off('connect', ask);
  });

  // Each turn starts on blank boards; then the server is asked for anything already drawn on them.  It runs after the
  // table has been redrawn (`post`), because a new turn may have put the boards in a different order on the screen.
  watch(
    turnKey,
    () => {
      for (const board of boards()) board?.reset([]);
      ask();
    },
    { flush: 'post' },
  );

  return { ask };
}
