<script setup>
// Azulejo: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
//
// Props:
//   socket     {Object}    required. The platform's socket connection for this game.
//   user       {Object}    the signed-in user, or null (unused here; part of the module contract).
//   search     {string}    the page's current query string, used to pick up an invite code.
//   setSearch  {Function}  updates the page's query string (used to put the room code in the address bar).
// Emits: none. Slots: none.
// Side effects: useGameSocket subscribes to the socket, and sends create/join requests when the player chooses to;
// it also installs a leave confirmation while a game is in progress.
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
  // Returns the warning to show before leaving mid-game, or '' for no warning.
  leaveConfirm: (state) => state.phase === 'playing' || state.phase === 'tiling' ? 'A computer player takes your seat if you leave.' : '',
});
</script>

<template>
  <div class="azulejo stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Azulejo"
      intro="Draft painted tiles from the display plates and build a patterned wall. Two to five players; computer players can fill any empty seats."
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
