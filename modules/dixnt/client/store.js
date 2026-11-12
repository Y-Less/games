// The game's own view state — the Recent moves list, the word pop-up and the card lightbox — on top of the plumbing
// every room game shares (src/useGameSocket.js), which owns the socket, the room's state, the "busy" flag, the refusal
// notice, the invite code in the address bar and the header's "Leave game" button.  The root component builds this once
// from its setup and shares it with every component below through useDixnt.js.
// Depends on: vue, src/useGameSocket.js and ./moveLog.js.
import { computed, reactive, ref } from 'vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
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
 * Creates the game store.  Call it from a component's setup: the shared plumbing underneath registers its socket
 * listeners and the header's "Leave game" button for the life of that component.
 *
 * @param {object} options
 * @param {object} options.socket  the site's socket for this game
 * @param {object} options.user  the signed-in user
 * @param {string} [options.search]  the page's query string, whose invite code is used the first time
 * @param {(search: string) => void} [options.setSearch]  puts the room code in the address bar
 * @param {(state: object) => string} [options.leaveConfirm]  what to ask before leaving, or '' to leave at once
 * @returns {object} { store, user, send, busy, initialCode, players, nameOf, chooser, isHost, cardUrl }.
 *   `store` holds `state`, `loaded`, `notice` and `connected` from the shared plumbing, and Dixnt's own `log`,
 *   `wordPopup`, `imposterWord` and `zoom`: all reactive, and writable where a component needs to set them.
 * Side effects: through useGameSocket, listens on the socket and resumes the player's room on every connection.
 */
export function createStore({ socket, user, search = '', setSearch = () => {}, leaveConfirm = () => '' }) {
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
    // The word being chosen is announced to everyone at the same moment (the imposter sees ???), once per round.
    if (next && previous?.phase === 'word' && next.phase === 'picking') {
      // `hidden` says the viewer is the one kept in the dark; the pop-up itself writes what they see instead.
      wordPopup.value = { word: next.wordHidden ? null : next.word, key: `${next.round}:${next.completedRounds}`, hidden: Boolean(next.wordHidden), at: Date.now() };
    }
    // The player who was kept in the dark is let in on the word as the voting opens, in a small pop-up of their own:
    // everybody else has known it all along, so it is news to them alone.  `wordHidden` says so only while the cards
    // are going down, which is why it is the state before this one that is asked.
    if (next?.phase === 'voting' && previous?.phase === 'picking' && previous.wordHidden) {
      imposterWord.value = { word: next.word, key: `${next.round}:${next.completedRounds}` };
    }
    // A new round, the lobby, or no game at all: last round's word is not news any more.
    if (!next || next.phase === 'word' || next.phase === 'lobby') imposterWord.value = null;
    // Back in the lobby, or out of the game, nothing from the last round may be left to show: the word pop-up is
    // replayed by the next game's pop-up component when it mounts, and a lightbox would still hold a card from before.
    if (!next || next.phase === 'lobby') {
      wordPopup.value = null;
      zoom.value = null;
    }
  }

  const { state, loaded, busy, notice, connected, initialCode, send } = useGameSocket({ socket, search, setSearch, leaveConfirm, onState });
  // A reactive object of refs: Vue unwraps them, so a component reads `store.state` and writes `store.zoom` as before.
  const store = reactive({ state, loaded, busy, notice, connected, log, wordPopup, imposterWord, zoom });

  // Everyone in the game ([] before there is a state).
  const players = computed(() => store.state?.players ?? []);
  // Returns a player's name by id ('?' if unknown).  A table keyed by a player id has text keys, while a person's id
  // is their account number, so the two are matched as text.
  const nameOf = (id) => players.value.find((p) => String(p.id) === String(id))?.name ?? '?';
  // The player choosing the word this round, or null.
  const chooser = computed(() => players.value.find((p) => p.isChooser) ?? null);
  // True when the viewer is the host.
  const isHost = computed(() => Boolean(store.state) && store.state.hostId === store.state.me.id);

  return { store, user, send, busy, initialCode, players, nameOf, chooser, isHost, cardUrl };
}
