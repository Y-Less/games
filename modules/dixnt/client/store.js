// Client-side game store: the latest personalised state from the server, over the socket the site gives us.
import { computed, reactive } from 'vue';
import { normaliseCode } from '../../../shared/codes.js';
import { newEntries } from './moveLog.js';

/** The code in an invite link (or a pasted one), tidied with the site's shared rules; '' if there is none. */
const tidyCode = normaliseCode;

export const cardUrl = (cardId, size = 'medium') => `/assets/dixnt/cards/${size}/card_${String(cardId).padStart(4, '0')}.jpg`;

/**
 * @param {{ socket: object, user: object, search: string, setSearch: (search: string) => void }} options
 */
export function createStore({ socket, user, search, setSearch }) {
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
  function showToast(message) {
    store.toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (store.toast = ''), 4000);
  }

  /** Sends an event to the server and resolves with its reply. Errors are shown as a toast. */
  function send(event, payload = {}, { quiet = false } = {}) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (reply) => {
        if (reply && !reply.ok && !quiet) showToast(reply.error);
        resolve(reply ?? { ok: false });
      });
    });
  }

  /** Asks whether the game that store.code points at still exists (so an invite page can say so). */
  async function lookUpCode() {
    store.codeExists = null;
    if (!store.code) return;
    const asked = store.code;
    const reply = await send('lookup', { code: asked }, { quiet: true });
    if (store.code === asked) store.codeExists = Boolean(reply.exists);
  }

  async function onConnect() {
    store.connected = true;
    const reply = await send('resume', { code: store.code }, { quiet: true });
    if (!reply.ok) await lookUpCode();
    store.checkedSession = true;
  }
  const onDisconnect = () => {
    store.connected = false;
  };
  function onState(state) {
    store.log = !state || state.phase === 'lobby' ? [] : [...store.log, ...newEntries(store.state, state)].slice(-200);
    // The word being chosen is announced to everyone at the same moment (the imposter sees ???), once per round.
    if (state && store.state?.phase === 'word' && state.phase === 'picking') {
      store.wordPopup = { word: state.wordHidden ? '???' : state.word, key: `${state.round}:${state.completedRounds}`, hidden: Boolean(state.wordHidden), at: Date.now() };
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

  /** Back to the start screen: forget the current code and show the create/join form. */
  function goHome() {
    store.code = '';
    store.codeExists = null;
    setSearch('');
  }

  const createGame = () => send('create');
  const join = (code = store.code) => send('join', { code });

  const players = computed(() => store.state?.players ?? []);
  const nameOf = (id) => players.value.find((p) => p.id === id)?.name ?? '?';
  const chooser = computed(() => players.value.find((p) => p.isChooser) ?? null);
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
    dispose() {
      clearTimeout(toastTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
    },
  };
}
