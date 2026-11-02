// Client-side game store: the latest personalised state from the server, over the socket the site gives us.
import { computed, reactive } from 'vue';
import { normaliseCode } from '../../../shared/codes.js';
import { newEntries } from './moveLog.js';

/**
 * Tidies the code in an invite link (or a pasted one) with the site's shared rules; '' if there is none.
 * @param {string} text  The query string or pasted code.
 * @returns {string} The normalised code.
 * Side effects: none.
 */
const tidyCode = normaliseCode;

/**
 * Gives the URL of a card image.
 * @param {number|string} cardId  The card's number.
 * @param {string} [size]  Name of the image size folder under cards/ (default 'medium'; the hand uses 'small').
 * @returns {string} The asset path, with the id zero-padded to four digits.
 * Side effects: none.
 */
export const cardUrl = (cardId, size = 'medium') => `/assets/dixnt/cards/${size}/card_${String(cardId).padStart(4, '0')}.jpg`;

/**
 * Creates the game store: reactive state fed by the server's `state` events, plus the actions the components use.
 * @param {{ socket: object, user: object, search: string, setSearch: (search: string) => void, error: (reply: object) => string }} options
 *   socket is the site's socket; user the signed-in user; search the page's query string (an invite code may be in it);
 *   setSearch puts the current game code in the address bar; error turns a server refusal into words in the player's
 *   language (useGameText's `error`), because nothing outside a locale file writes any.
 * @returns {object} { store, user, send, showToast, goHome, createGame, join, players, nameOf, chooser, isHost, cardUrl, dispose }.
 * Side effects: listens to the socket's connect, disconnect, and state events (removed by `dispose()`); emits resume,
 * lookup, and game requests; may start a timer for the toast; calls `setSearch` when the game code changes.
 */
export function createStore({ socket, user, search, setSearch, error }) {
  const store = reactive({
    connected: socket.connected,
    checkedSession: false, // true once the server has said whether we are already in a game
    state: null,
    log: [], // "Recent moves": worked out here from the changes between one state and the next
    code: tidyCode(search), // the game we are in, or the one an invite link points at
    codeExists: null, // for an invite link: does that game exist? (null until the server has said)
    toast: '',
    wordPopup: null, // { word, key, hidden, at }: the word just chosen, shown large to everyone for a few seconds
    zoom: null, // { cardId, actions: [{ label, run, primary }] } for the card lightbox
  });

  let toastTimer = null;
  /**
   * Shows a message in the toast for four seconds (a newer one replaces it).
   * @param {string} message  The text to show.
   * @returns {void}
   * Side effects: sets `store.toast` and (re)starts the clearing timer.
   */
  function showToast(message) {
    store.toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (store.toast = ''), 4000);
  }

  /**
   * Sends an event to the server and resolves with its reply.  Errors are shown as a toast.
   * @param {string} event  The request name.
   * @param {object} [payload]  Request data.
   * @param {{quiet?: boolean}} [options]  quiet suppresses the error toast (for requests whose failure is expected).
   * @returns {Promise<{ok: boolean, error?: string}>} The server's reply ({ ok: false } if there was none); never rejects.
   * Side effects: emits on the socket; may call showToast.
   */
  function send(event, payload = {}, { quiet = false } = {}) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (reply) => {
        if (reply && !reply.ok && !quiet) showToast(error(reply));
        resolve(reply ?? { ok: false });
      });
    });
  }

  /**
   * Asks whether the game that store.code points at still exists (so an invite page can say so).
   * @returns {Promise<void>}
   * Side effects: sends a quiet `lookup`; sets `store.codeExists` (null while waiting, ignored if the code changed meanwhile).
   */
  async function lookUpCode() {
    store.codeExists = null;
    if (!store.code) return;
    const asked = store.code;
    const reply = await send('lookup', { code: asked }, { quiet: true });
    if (store.code === asked) store.codeExists = Boolean(reply.exists);
  }

  /**
   * Handles the socket connecting (or reconnecting): tries to resume the player's game, else checks the invite code.
   * @returns {Promise<void>}
   * Side effects: sets `connected` and `checkedSession`; sends `resume` (and maybe `lookup`).
   */
  async function onConnect() {
    store.connected = true;
    const reply = await send('resume', { code: store.code }, { quiet: true });
    if (!reply.ok) await lookUpCode();
    store.checkedSession = true;
  }
  // Marks the connection as lost (the page then shows its offline banner).
  const onDisconnect = () => {
    store.connected = false;
  };
  /**
   * Takes in a new personalised state from the server (null when the player is no longer in a game).
   * @param {object | null} state  The new state.
   * @returns {void}
   * Side effects: updates `store.log`, `wordPopup`, `zoom`, `state`, and `code`; calls `setSearch`; looks the code up when
   * there is no game.
   */
  function onState(state) {
    store.log = !state || state.phase === 'lobby' ? [] : [...store.log, ...newEntries(store.state, state)].slice(-200);
    // The word being chosen is announced to everyone at the same moment (the imposter sees ???), once per round.
    if (state && store.state?.phase === 'word' && state.phase === 'picking') {
      // `hidden` says the viewer is the one kept in the dark; the pop-up itself writes what they see instead.
      store.wordPopup = { word: state.wordHidden ? null : state.word, key: `${state.round}:${state.completedRounds}`, hidden: Boolean(state.wordHidden), at: Date.now() };
    }
    store.state = state;
    // Back in the lobby (a new game is about to start), nothing from the last game may be left to show: the word popup is
    // replayed by the next game's popup component when it mounts, and a lightbox would still hold a card from before.
    if (state?.phase === 'lobby') {
      store.wordPopup = null;
      store.zoom = null;
    }
    if (state) {
      store.code = state.code;
      setSearch(state.code);
    } else {
      store.zoom = null;
      store.wordPopup = null;
      lookUpCode();
    }
  }

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('state', onState);
  if (socket.connected) onConnect();

  /**
   * Goes back to the start screen: forgets the current code and shows the create/join form.
   * @returns {void}
   * Side effects: clears `store.code` and `codeExists`; clears the address bar's code.
   */
  function goHome() {
    store.code = '';
    store.codeExists = null;
    setSearch('');
  }

  // Asks the server to create a game; returns the request's promise.
  const createGame = () => send('create');
  // Asks the server to join a game (by default the one in store.code); returns the request's promise.
  const join = (code = store.code) => send('join', { code });

  // Everyone in the game ([] before there is a state).
  const players = computed(() => store.state?.players ?? []);
  // Returns a player's name by id ('?' if unknown).
  const nameOf = (id) => players.value.find((p) => p.id === id)?.name ?? '?';
  // The player choosing the word this round, or null.
  const chooser = computed(() => players.value.find((p) => p.isChooser) ?? null);
  // True when the viewer is the host.
  const isHost = computed(() => Boolean(store.state) && store.state.hostId === store.state.me.id);

  return {
    store,
    user,
    send,
    showToast,
    goHome,
    createGame,
    join,
    players,
    nameOf,
    chooser,
    isHost,
    cardUrl,
    // Stops the timer and detaches the socket listeners (call when the root component unmounts).
    dispose() {
      clearTimeout(toastTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
    },
  };
}
