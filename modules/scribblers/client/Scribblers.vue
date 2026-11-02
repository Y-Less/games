<script setup>
// Scribblers: the screens drawn inside the site's play field.  The server sends each player their own view of the game
// as a `state` event (null when not in a game); everything the player does is a request to the server (see
// useGameSocket).  The drawing itself travels on its own events, which the table listens for.
// Props: socket (the module's socket), user (signed-in user or null), search / setSearch (read and write the page's
// query string, which carries the invite code).  Emits: none.  Slots: none.
// Side effects: useGameSocket subscribes to the socket's state events and may change the URL's query string; the create
// and join events send requests; onState keeps the Recent moves list.
import { ref } from 'vue';
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import { useGameText } from '../../../src/useGameText.js';
import Lobby from './Lobby.vue';
import { newEntries } from './moveLog.js';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});
const { t } = useGameText();

const log = ref([]); // "Recent moves": messages (see moveLog.js), worked out from the changes between one state and the next

/**
 * Works the "Recent moves" list out from the change between one state and the next.
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {void} (the list is kept to the last 200 lines, and cleared outside a game)
 * Side effects: replaces `log`.
 */
function onState(next, previous) {
  log.value = !next || next.phase === 'lobby' ? [] : [...log.value, ...newEntries(previous, next)].slice(-200);
}

const { state, loaded, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Warns before leaving a game in progress, because there is no way back in.
  // @param {object} state  the current view; @returns {string} the warning, or '' when leaving is harmless.  No side effects.
  leaveConfirm: (state) => (['choosing', 'drawing', 'between', 'scores'].includes(state.phase) ? t('leaveConfirm') : ''),
  onState,
});
</script>

<template>
  <div class="scribblers stack">
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
      <Table v-else :state="state" :send="send" :socket="socket" :log="log" />
    </template>
  </div>
</template>
