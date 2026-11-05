<script setup>
// Trivium: the screens drawn inside the site's play field.  The server sends each player their own view of the game
// as a `state` event (null when not in a game); everything the player does is a request to the server.
// Props: socket (the platform's socket), user (the signed-in user or null), search (the page's query string, which may
//   carry an invite code), setSearch (updates the query string).
// Emits: none.  Slots: none.
// Side effects: useGameSocket subscribes to the socket's state events and calls onState for each; leaving mid-game
//   asks for confirmation; RoomEntry's create and join send requests.
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

const log = ref([]); // "Recent moves": worked out here from the changes between one state and the next
/**
 * Works the "Recent moves" list out from the change between one state and the next.  The list is emptied outside a
 * game and capped at the latest 200 lines.
 *
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {void}
 * Side effects: replaces `log`.
 */
function onState(next, previous) {
  log.value = !next || next.phase === 'lobby' ? [] : [...log.value, ...newEntries(previous, next)].slice(-200);
}

// state is the player's view (null outside a game); loaded is false until the first reply; notice is the latest error.
const { state, loaded, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  leaveConfirm: (state) => (['spin', 'question', 'reveal'].includes(state.phase) ? t('leaveConfirm') : ''),
  onState,
});
</script>

<template>
  <div class="trivium stack">
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
