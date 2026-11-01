<script setup>
// Rummikub: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
// Props: socket (the platform's socket), user (the signed-in user or null), search (the page's query string, which may carry an
//   invite code), setSearch (updates the query string).
// Emits: none. Slots: none.
// Side effects: useGameSocket subscribes to the socket's state events; RoomEntry's create and join send requests.
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

// state is the player's view (null outside a game); loaded is false until the first reply; notice is the latest error text.
const { state, loaded, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Returns the warning to show before leaving mid-game (a round or the pause between rounds), or '' for no warning.
  leaveConfirm: (state) => (state.phase === 'playing' || state.phase === 'between' ? 'A computer player takes your seat if you leave.' : ''),
});
</script>

<template>
  <div class="rummikub stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Rummikub"
      intro="Build runs and groups from numbered tiles, rearrange the whole table and be first to empty your rack. Two to six players; computer players can fill any empty seats."
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
