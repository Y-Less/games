<script setup>
// Cribbage: the screens drawn inside the site's play field.  The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
//
// Props:
//   socket     {Object}    required.  The platform's socket connection for this game.
//   user       {Object}    the signed-in user, or null (unused here; part of the module contract).
//   search     {string}    the page's current query string; its invite code (after the '?') prefills the join box.
//   setSearch  {Function}  updates the page's query string (puts the room code in the address bar).
// Emits: none.  Slots: none.
// Side effects: useGameSocket subscribes to the socket and sends create/join requests; it also installs a leave
// confirmation mid-game.
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import { useGameText } from '../../../src/useGameText.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});
const { t } = useGameText();

const { state, loaded, busy, notice, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Returns the warning to show before leaving mid-game, or '' for no warning.
  leaveConfirm: (state) => (state.phase !== 'lobby' && state.phase !== 'finished' ? t('leaveConfirm') : ''),
});
</script>

<template>
  <div class="cribbage stack">
    <ErrorToast v-if="loaded && state && notice" :text="notice" />
    <p v-if="!loaded" class="muted">{{ t('play.loading') }}</p>
    <RoomEntry v-else-if="!state" :noun="t('entry.noun')" :intro="t('entry.intro')" :busy="busy" :error="notice" :initial-code="search.replace(/^\?/, '')" @create="send('create')" @join="(code) => send('join', { code })" />

    <template v-else>
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" />
    </template>
  </div>
</template>
