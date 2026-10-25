<script setup>
// Azulejo: the screens drawn inside the site's play field. The server sends each player their own view of the game as
// a `state` event (null when not in a game); everything the player does is a request to the server.
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
const notice = ref('');
let invite = props.search.replace(/^\?/, '');
const initialCode = invite;

function send(event, payload = {}) {
  notice.value = '';
  return new Promise((resolve) => {
    props.socket.emit(event, payload, (reply) => {
      if (!reply?.ok) notice.value = reply?.error ?? 'The server did not answer.';
      resolve(reply ?? { ok: false });
    });
  });
}

async function resume() {
  const code = state.value?.code ?? invite;
  invite = '';
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
      <p v-if="notice" class="notice" role="alert">{{ notice }}</p>
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" />
    </template>
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
