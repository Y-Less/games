<script setup>
// Cheat: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
//
// Props:
//   socket     {Object}    required. The platform's socket connection for this game.
//   user       {Object}    the signed-in user, or null (unused here; part of the module contract).
//   search     {string}    the page's current query string, used to pick up an invite code.
//   setSearch  {Function}  updates the page's query string (puts the room code in the address bar).
// Emits: none. Slots: none.
// Side effects: useGameSocket subscribes to the socket and sends create/join requests; this component also keeps the
// Recent moves list (`log`), updated from every incoming state, and installs a leave confirmation mid-game.
import { ref } from 'vue';
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import { useGameText } from '../../../src/useGameText.js';
import { advanceLog } from './log.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});

// The Recent moves list shown by the table.
const { t } = useGameText();

const log = ref([]); // Recent moves (messages), worked out from the states as they arrive (see log.js)
/**
 * Works the list of recent moves out from each state as it arrives (see log.js).
 *
 * Side effects: replaces `log`.
 *
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 */
function onState(next, previous) {
  try {
    log.value = advanceLog(log.value, previous, next);
  } catch {
    log.value = []; // the list is only a convenience: never let it stop the table from updating
  }
}

const { state, loaded, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Returns the warning to show before leaving mid-game, or '' for no warning.
  leaveConfirm: (state) => (state.phase !== 'lobby' && state.phase !== 'finished' ? t('leaveConfirm') : ''),
  onState,
});
</script>

<template>
  <div class="cheat stack">
    <p v-if="!loaded" class="muted">{{ t('play.loading') }}</p>
    <RoomEntry
      v-else-if="!state"
      :noun="t('entry.noun')"
      :intro="t('entry.intro')"
      :initial-code="initialCode"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <ErrorToast v-if="notice" :text="notice" />
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" :log="log" />
    </template>
  </div>
</template>
