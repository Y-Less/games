<script setup>
// Nomination Whist: the screens drawn inside the site's play field. The server sends each player their own view of
// the game as a `state` event (null when not in a game); everything the player does is a request to the server.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});

const state = ref(null);
const loaded = ref(false);
const busy = ref(false);
const notice = ref('');
const invite = props.search.replace(/^\?/, '');
let pendingInvite = invite;

function send(event, payload = {}) {
  notice.value = '';
  busy.value = true;
  return new Promise((resolve) => {
    props.socket.emit(event, payload, (reply) => {
      busy.value = false;
      if (!reply?.ok) notice.value = reply?.error ?? 'The server did not answer.';
      resolve(reply ?? { ok: false });
    });
  });
}

async function resume() {
  const code = state.value?.code ?? pendingInvite;
  pendingInvite = '';
  await send('resume', { code });
}

function onState(next) {
  state.value = next;
  loaded.value = true;
  props.setSearch(next ? next.code : '');
}

onMounted(() => {
  props.socket.on('state', onState);
  props.socket.on('connect', resume);
  if (props.socket.connected) resume();
});
onBeforeUnmount(() => {
  props.socket.off('state', onState);
  props.socket.off('connect', resume);
});
</script>

<template>
  <div class="whist stack">
    <p v-if="notice && state" class="notice" role="alert">{{ notice }}</p>
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game"
      intro="Oh Hell-style whist for 3 to 7 players: nominate exactly how many tricks you will win."
      :busy="busy"
      :error="notice"
      :initial-code="invite"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <Lobby v-else-if="state.phase === 'lobby'" :state="state" :send="send" />
    <Table v-else :state="state" :send="send" />
  </div>
</template>

<style scoped>
.notice {
  margin: 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--danger);
  border-radius: 12px;
  color: var(--danger);
}
</style>
