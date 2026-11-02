<script setup>
// Hearts: the screens drawn inside the site's play field.  The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
// Props: socket (the platform's socket wrapper), user (signed-in user or null), search / setSearch (read and write the
// page's query string, which carries the invite code).  Emits: none.  Slots: none.
// Side effects: useGameSocket subscribes to the socket's state and notice events and may change the URL's query string;
// the create and join events send requests; onState keeps the Recent moves list.
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
const { t } = useGameText();

const log = ref([]); // Recent moves, worked out from the states as they arrive (see log.js)
/**
 * Works the list of recent moves out from each state as it arrives (see log.js).
 *
 * Side effects: replaces `log`.
 *
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {void}
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
  // Warns before leaving a live game (hands in progress), because leaving hands the seat to a computer player.
  // @param {object} state  the current view; @returns {string} the warning, or '' when leaving is harmless.  No side effects.
  leaveConfirm: (state) => (state.phase !== 'lobby' && state.phase !== 'finished' ? t('leaveConfirm') : ''),
  onState,
});
</script>

<template>
  <div class="hearts stack">
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
