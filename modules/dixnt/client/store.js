// Dixnt's own view state — the Recent moves list, the word pop-up and the card lightbox — beside what the shared
// screen (src/components/GameShell.vue) keeps for every game: the socket, the room's state, the refusal notice, the
// invite code in the address bar and the header's "Leave game" button.  The root component builds this once from its
// setup and shares it with every component below through useDixnt.js.
// Depends on: vue and ./moveLog.js.
import { computed, reactive, ref } from 'vue';
import { newEntries } from './moveLog.js';

/**
 * Gives the URL of a card image.
 * @param {number|string} cardId  The card's number.
 * @param {string} [size]  Name of the image size folder under cards/ (default 'medium'; the hand uses 'small').
 * @returns {string} The asset path, with the id zero-padded to four digits.
 * Side effects: none.
 */
export const cardUrl = (cardId, size = 'medium') => `/assets/dixnt/cards/${size}/card_${String(cardId).padStart(4, '0')}.jpg`;

/**
 * Creates the game store.
 *
 * @param {object} options
 * @param {import('vue').Ref<{ state: object | null, send: Function } | null>} options.shell  the mounted GameShell,
 *   which holds the room's state and sends requests (null until it is mounted, and so until there can be a state)
 * @param {object} [options.user]  the signed-in user
 * @returns {object} { store, user, send, onState, players, nameOf, chooser, isHost, cardUrl }.  `store` holds the
 *   shell's `state`, and Dixnt's own `log`, `wordPopup`, `imposterWord` and `zoom`: all reactive, and writable where
 *   a component needs to set them.  `onState(next, previous)` is what the shell is given to call with each state.
 * Side effects: none until `onState` or `send` is called.
 */
export function createStore({ shell, user = null }) {
  const log = ref([]); // "Recent moves": worked out here from the changes between one state and the next
  const wordPopup = ref(null); // { word, key, hidden, at }: the word just chosen, shown large to everyone for a few seconds
  const imposterWord = ref(null); // { word, key }: the word the viewer was kept from, told to them as the voting opens
  const zoom = ref(null); // { cardId, actions: [{ label, run, primary }] } for the card lightbox

  /**
   * Takes in a new personalised state from the server (null when the player is no longer in a game).
   * @param {object | null} next  The new state.
   * @param {object | null} previous  The state it replaces.
   * @returns {void}
   * Side effects: updates `log`, `wordPopup`, `imposterWord` and `zoom`.
   */
  function onState(next, previous) {
    log.value = !next || next.phase === 'lobby' ? [] : [...log.value, ...newEntries(previous, next)].slice(-200);
    // The word being chosen is announced to everyone at the same moment (the imposter sees ???), once per turn.
    if (next && previous?.phase === 'word' && next.phase === 'picking') {
      // `hidden` says the viewer is the one kept in the dark; the pop-up itself writes what they see instead.
      wordPopup.value = { word: next.wordHidden ? null : next.word, key: `${next.turn}:${next.completedTurns}`, hidden: Boolean(next.wordHidden), at: Date.now() };
    }
    // The player who was kept in the dark is let in on the word as the voting opens, in a small pop-up of their own:
    // everybody else has known it all along, so it is news to them alone.  `wordHidden` says so only while the cards
    // are going down, which is why it is the state before this one that is asked.
    if (next?.phase === 'voting' && previous?.phase === 'picking' && previous.wordHidden) {
      imposterWord.value = { word: next.word, key: `${next.turn}:${next.completedTurns}` };
    }
    // A new turn, the lobby, or no game at all: last turn's word is not news any more.
    if (!next || next.phase === 'word' || next.phase === 'lobby') imposterWord.value = null;
    // Back in the lobby, or out of the game, nothing from the last turn may be left to show: a lightbox would still
    // hold a card from before.
    if (!next || next.phase === 'lobby') {
      wordPopup.value = null;
      zoom.value = null;
    }
  }

  // The room's state is the shell's (null outside a room, and before the shell is mounted).
  const state = computed(() => shell.value?.state ?? null);
  // A reactive object of refs: Vue unwraps them, so a component reads `store.state` and writes `store.zoom`.
  const store = reactive({ state, log, wordPopup, imposterWord, zoom });

  /**
   * Sends one request to the server, through the shell.
   * @param {string} event  the socket event name
   * @param {object} [payload]  what the event needs
   * @returns {Promise<{ ok: boolean, error?: string }>} the server's reply
   * Side effects: as the shell's `send` (src/useGameSocket.js).
   */
  const send = (event, payload) => shell.value.send(event, payload);

  // Everyone in the game ([] before there is a state).
  const players = computed(() => store.state?.players ?? []);
  // Returns a player's name by id ('?' if unknown).  A table keyed by a player id has text keys, while a person's id
  // is their account number, so the two are matched as text.
  const nameOf = (id) => players.value.find((p) => String(p.id) === String(id))?.name ?? '?';
  // The player choosing the word this turn, or null.
  const chooser = computed(() => players.value.find((p) => p.isChooser) ?? null);
  // True when the viewer is the host.
  const isHost = computed(() => Boolean(store.state) && store.state.hostId === store.state.you);

  return { store, user, send, onState, players, nameOf, chooser, isHost, cardUrl };
}
