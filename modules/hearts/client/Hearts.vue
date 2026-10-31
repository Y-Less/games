<script setup>
// Hearts: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
import { ref } from 'vue';
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import { advanceLog } from './log.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});

const log = ref([]); // Recent moves, worked out from the states as they arrive (see log.js)
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
  leaveConfirm: (state) => state.phase !== 'lobby' && state.phase !== 'finished' ? 'A computer player takes your seat if you leave.' : '',
  onState,
});
</script>

<template>
  <div class="hearts stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Hearts"
      intro="Three to seven players (four is usual), one deck, and the lowest score wins. Computer players can fill any empty seats."
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
