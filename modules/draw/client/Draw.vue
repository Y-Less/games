<script setup>
// Draw!: the screens drawn inside the site's play field.  The server sends each player their own view of the room as
// a `state` event (null when not in one); everything a player does is a request to the server (see useGameSocket).
// The drawings themselves do not come that way - they arrive as `draw` and `canvas` events, which the table listens
// for, so the socket is passed down to it.
//
// Props: socket (the platform's socket wrapper), user (signed-in user or null), search / setSearch (read and write the
// page's query string, which carries the invite code).  Emits: none.  Slots: none.
// Side effects: useGameSocket listens on the socket, keeps the invite code in the address bar and registers the
// header's "Leave game" button.
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

const { state, loaded, busy, notice, connected, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // A computer player takes your place mid-game and carries on with your drawing, so leaving costs the table nothing.
  leaveConfirm: () => '',
});
</script>

<template>
  <div class="draw stack">
    <p v-if="!loaded" class="muted">{{ $t('play.loading') }}</p>
    <RoomEntry
      v-else-if="!state"
      :noun="t('entry.noun')"
      :intro="t('entry.intro')"
      :initial-code="initialCode"
      :busy="busy"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <ErrorToast v-if="notice" :text="notice" />
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" :socket="socket" />
      <Teleport to="body">
        <div v-if="!connected" class="offline" role="status">{{ t('table.offline') }}</div>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.offline {
  position: fixed;
  top: 0.8rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  background: var(--rust);
  color: #fff;
}
</style>
