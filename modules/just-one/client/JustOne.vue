<script setup>
// Just One: the screens drawn inside the site's play field.  The server sends each player their own view of the game as
// a `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
// GameShell draws the loading line, the "new game or invite code" screen, and the error toast, and hands the state to
// the lobby or the table below.  What is Just One's own here is the list of recent moves, worked out from each state as
// it arrives.
//
// Props:
//   socket     {Object}    required.  The platform's socket connection for this game.
//   user       {Object}    the signed-in user, or null (unused here; part of the module contract).
//   search     {string}    the page's current query string, used to pick up an invite code.
//   setSearch  {Function}  updates the page's query string (used to put the room code in the address bar).
// Emits: none.  Slots: none.
// Side effects: as GameShell, and `log` is replaced on every state.
import { ref } from 'vue';
import GameShell from '../../../src/components/GameShell.vue';
import WordPopup from '../../../src/components/WordPopup.vue';
import { useGameText } from '../../../src/useGameText.js';
import Lobby from './Lobby.vue';
import { newEntries } from './moveLog.js';
import { wordAnnounced } from './popups.js';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});
const { t } = useGameText();

const log = ref([]); // "Recent moves": messages (see moveLog.js), worked out here from the changes between one state and the next
const popup = ref(null); // { label, word, dark, at }: the word a turn has just begun with, shown large for a few seconds
/** What the guesser is shown in place of the word, as on the table. */
const HIDDEN = '???';

/**
 * Adds whatever the new state says has happened to the list of recent moves.
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {void}
 * Side effects: replaces `log`.
 */
function onState(next, previous) {
  log.value = !next || next.phase === 'lobby' ? [] : [...log.value, ...newEntries(previous, next)].slice(-200);
  // The word a turn begins with is announced to the whole table at once (the shared word pop-up): the writers see
  // it, and the guesser sees that there is one.  It is not news once the clues are in.
  const word = wordAnnounced(next, previous);
  if (word) popup.value = { label: t(word.hidden ? 'popup.wordHidden' : 'popup.wordIs'), word: word.hidden ? HIDDEN : word.word, dark: word.hidden, at: Date.now() };
  else if (!next || next.phase !== 'clues') popup.value = null;
}

/** The warning to show before leaving mid-game, or '' for no warning. */
const leaveConfirm = (state) => (['clues', 'guessing', 'choosing', 'reveal'].includes(state.phase) ? t('leaveConfirm') : '');
</script>

<template>
  <div class="just-one stack">
    <GameShell :socket="props.socket" :search="props.search" :set-search="props.setSearch" :leave-confirm="leaveConfirm" :on-state="onState" :noun="t('entry.noun')" :intro="t('entry.intro')">
      <template #lobby="{ state, send }"><Lobby :state="state" :send="send" /></template>
      <template #table="{ state, send }"><Table :state="state" :send="send" :log="log" /></template>
      <template #overlay><WordPopup :popup="popup" /></template>
    </GameShell>
  </div>
</template>
