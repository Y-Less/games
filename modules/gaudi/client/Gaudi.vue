<script setup>
// Gaudi: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
// Props: socket (the platform's socket wrapper), user (signed-in user or null), search / setSearch (read and write the
// page's query string, which carries the invite code). Emits: none. Slots: none.
// Side effects: useGameSocket subscribes to the socket's state and notice events and may change the URL's query string;
// the create and join events send requests.
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});

const { state, loaded, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Warns before leaving a live game, because leaving hands the seat to a computer player.
  // @param {object} state  the current view; @returns {string} the warning, or '' when leaving is harmless. No side effects.
  leaveConfirm: (state) => state.phase === 'windows' || state.phase === 'playing' ? 'A computer player takes your seat if you leave.' : '',
});
</script>

<template>
  <div class="gaudi stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Gaudi"
      intro="Draft dice and build a stained-glass window over ten rounds. Two to five players; computer players can fill any empty seats."
      :initial-code="initialCode"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <ErrorToast v-if="notice" :text="notice" />
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" />
    </template>
  </div>
</template>
