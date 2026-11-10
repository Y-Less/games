<script setup>
// Cheat: the screens drawn inside the site's play field.  The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
// GameShell draws the loading line, the "new game or invite code" screen, and the error toast, and hands the state to
// the lobby or the table below.  What is Cheat's own here is the list of recent moves, worked out from each state as
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
import { useGameText } from '../../../src/useGameText.js';
import { advanceLog } from './moveLog.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});
const { t } = useGameText();

const log = ref([]); // Recent moves (messages), worked out from the states as they arrive (see log.js)

/**
 * Works the list of recent moves out from each state as it arrives (see log.js).
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {void}
 * Side effects: replaces `log`.
 */
function onState(next, previous) {
  try {
    log.value = advanceLog(log.value, previous, next);
  } catch {
    log.value = []; // the list is only a convenience: never let it stop the table from updating
  }
}

/** The warning to show before leaving mid-game, or '' for no warning. */
const leaveConfirm = (state) => (state.phase !== 'lobby' && state.phase !== 'finished' ? t('leaveConfirm') : '');
</script>

<template>
  <div class="cheat stack">
    <GameShell :socket="props.socket" :search="props.search" :set-search="props.setSearch" :leave-confirm="leaveConfirm" :on-state="onState" :noun="t('entry.noun')" :intro="t('entry.intro')">
      <template #lobby="{ state, send }"><Lobby :state="state" :send="send" /></template>
      <template #table="{ state, send }"><Table :state="state" :send="send" :log="log" /></template>
    </GameShell>
  </div>
</template>
