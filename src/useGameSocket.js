// The plumbing every room-based game client shares: the latest personalised `state` from the module's socket, the
// error toast, the "busy" flag, joining or resuming a room on every (re)connection, the header's "Leave game" button,
// and tidying up when the client unmounts.  A game's top component calls `useGameSocket` once from its setup and keeps
// only what is its own (its log of recent moves, its screens).
// Depends on: vue and playBar.js (useLeave); the socket itself is passed in by the caller.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useLeave } from './playBar.js';
import { useGameText } from './useGameText.js';

/**
 * The code in an invite link such as "?boss-aware-you" (the search string with its leading "?" taken off).
 * @param {*} search  location.search (null/undefined count as empty)
 * @returns {string}  the code, or ''
 * Side effects: none.
 */
export const inviteFrom = (search) => String(search ?? '').replace(/^\?/, '');

/**
 * Connects a game client to its module socket.
 *
 * Side effects: listens for `state` and `connect` on the socket (removed again when the component unmounts); asks the
 * server to `resume` the player's room on every connection (using the invite code the first time); keeps the address
 * bar's invite code in step through `setSearch`; registers the header's "Leave game" button through useLeave.
 *
 * @param {object} options
 * @param {object} options.socket  the module's socket.io socket
 * @param {string} [options.search]  the address bar's search string, whose invite code is used the first time
 * @param {(search: string) => void} [options.setSearch]  puts the room code in the address bar ('' when not in a room)
 * @param {(state: object) => string} [options.leaveConfirm]  the text to ask before leaving, or '' to leave at once
 *   (called only while in a room)
 * @param {(next: object | null, previous: object | null) => void} [options.onState]  called with each new state and the
 *   one it replaces, just before it is shown (a game works its log of recent moves out here)
 * @returns {{ state: import('vue').Ref, loaded: import('vue').Ref<boolean>, busy: import('vue').Ref<boolean>,
 *   notice: import('vue').Ref<string>, initialCode: string, send: Function }}
 *   `state` is the current view (null when not in a room), `loaded` is true once the server has said which,
 *   `notice` is the latest error text, `initialCode` is the invite code the page was opened with, and `send` is
 *   `send(event, payload)`: emits the event, shows a refusal as the notice and resolves with the reply
 *   ({ ok, error? }; a failure if the server did not answer, or has not within ACK_TIMEOUT_MS).
 */
/** How long a request may wait for the server's answer before it is given up (milliseconds). */
export const ACK_TIMEOUT_MS = 10000;

export function useGameSocket({ socket, search = '', setSearch = () => {}, leaveConfirm = () => '', onState = () => {} }) {
  const state = ref(null);
  const loaded = ref(false);
  const busy = ref(false);
  const notice = ref('');
  const { error: errorWords } = useGameText(); // a refusal's code, in the player's language
  const initialCode = inviteFrom(search);
  let invite = initialCode; // used once, by the first `resume`

  /**
   * Sends one request to the server and waits for its answer.  A request the server never answers (its handler threw
   * before replying, or the connection dropped mid-way) is given up after ACK_TIMEOUT_MS, so `busy` cannot stick and
   * disable every button for good.
   *
   * Side effects: clears and may set `notice`; sets `busy` while waiting; emits a socket event; sets a timer.
   *
   * @param {string} event  the socket event name ('create', 'join', 'leave', ...)
   * @param {object} [payload]  what the event needs
   * @returns {Promise<{ ok: boolean, error?: string }>} the server's reply (a failure if it did not answer)
   */
  function send(event, payload = {}) {
    notice.value = '';
    busy.value = true;
    return new Promise((resolve) => {
      let settled = false;
      const settle = (reply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        busy.value = false;
        if (!reply?.ok) notice.value = errorWords(reply);
        resolve(reply ?? { ok: false });
      };
      const timer = setTimeout(() => settle(null), ACK_TIMEOUT_MS);
      socket.emit(event, payload, settle);
    });
  }

  // "Leave game" lives in the site's header; it is offered whenever you are in a room.
  useLeave({
    canLeave: computed(() => Boolean(state.value)),
    leave: () => send('leave'),
    confirmText: computed(() => (state.value ? leaveConfirm(state.value) || '' : '')),
  });

  /**
   * Asks the server to put this socket back into its room (or into the one the invite link names).  Runs on every
   * (re)connection; the invite is used only the first time.
   *
   * Side effects: emits `resume`.
   *
   * @returns {Promise<void>}
   */
  async function resume() {
    const code = state.value?.code ?? invite;
    invite = '';
    await send('resume', { code });
  }

  /**
   * The server sent a new view of the room (null when not in one).
   *
   * Side effects: calls the game's `onState`, replaces `state`, marks it loaded, and updates the address bar.
   *
   * @param {object | null} next  the new view of the room
   * @returns {void}
   */
  function receive(next) {
    onState(next, state.value);
    state.value = next;
    loaded.value = true;
    setSearch(next ? next.code : '');
  }

  onMounted(() => {
    socket.on('state', receive);
    socket.on('connect', resume);
    if (socket.connected) resume();
  });
  onBeforeUnmount(() => {
    socket.off('state', receive);
    socket.off('connect', resume);
  });

  return { state, loaded, busy, notice, initialCode, send };
}
