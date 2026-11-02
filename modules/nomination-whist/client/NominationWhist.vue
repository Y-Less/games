<script setup>
// Props: socket {Object, required} platform socket; user {Object|null} signed-in user; search {String} current URL query string;
// setSearch {Function} updates the URL query string.  Emits: none.  Slots: none.
// Side effects: useGameSocket subscribes to the socket's `state` events and syncs the invite code with the URL for the life of the component;
// onState keeps the Recent moves list.
// Nomination Whist: the screens drawn inside the site's play field.  The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
import { ref } from 'vue';
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import { useGameText } from '../../../src/useGameText.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';
import { movesBetween } from './log.js';

const LOG_KEPT = 120;
const { t } = useGameText();
const log = ref([]); // Recent moves, worked out from the states as they arrive (see log.js)
/**
 * Works the list of recent moves out from each state as it arrives.  It lives here, not in the table, so that every state
 * is looked at even when several arrive before the page redraws (a computer's play and the trick's end come close together).
 *
 * Side effects: replaces `log`.
 *
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {void}
 */
function onState(next, previous) {
  try {
    log.value = !next || next.phase === 'lobby' ? [] : [...log.value, ...movesBetween(previous, next)].slice(-LOG_KEPT);
  } catch {
    log.value = []; // the list is only a convenience: never let it stop the table from updating
  }
}

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});

const { state, loaded, busy, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Returns the warning shown when leaving mid-game ('' when leaving is harmless).
  leaveConfirm: (state) => (['nominating', 'playing', 'roundEnd'].includes(state.phase) ? t('leaveConfirm') : ''),
  onState,
});
</script>

<template>
  <div class="whist stack">
    <ErrorToast v-if="notice && state" :text="notice" />
    <p v-if="!loaded" class="muted">{{ t('play.loading') }}</p>
    <RoomEntry
      v-else-if="!state"
      :noun="t('entry.noun')"
      :intro="t('entry.intro')"
      :busy="busy"
      :error="notice"
      :initial-code="initialCode"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <Lobby v-else-if="state.phase === 'lobby'" :state="state" :send="send" />
    <Table v-else :state="state" :send="send" :log="log" />
  </div>
</template>
