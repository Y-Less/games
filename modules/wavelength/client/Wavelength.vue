<script setup>
// Wavelength: the screens drawn inside the site's play field. The server sends each player their own view of
// the game as a `state` event (null when not in a game); everything the player does is a request to the server.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useLeave } from '../../../src/playBar.js';
import Lobby from './Lobby.vue';
import { newEntries } from './moveLog.js';
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
const log = ref([]); // "Recent moves": worked out here from the changes between one state and the next
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

// "Leave game" lives in the site's header; it is offered whenever you are in a room, and asks first mid-game.
useLeave({
  canLeave: computed(() => Boolean(state.value)),
  leave: () => send('leave'),
  confirmText: computed(() => (['clue', 'guessing', 'reveal'].includes(state.value?.phase) ? 'You will not be able to come back.' : '')),
});

async function resume() {
  const code = state.value?.code ?? invite;
  invite = '';
  await send('resume', { code });
}

function onState(next) {
  log.value = !next || next.phase === 'lobby' ? [] : [...log.value, ...newEntries(state.value, next)].slice(-200);
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
  <div class="wavelength stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Wavelength"
      intro="Give a clue to a hidden spot between two opposites, and see how close your friends can turn the dial. You get a code to share."
      :initial-code="initialCode"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <p v-if="notice" class="notice" role="alert">{{ notice }}</p>
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" :log="log" />
    </template>
  </div>
</template>

<style scoped>
.notice {
  /* A toast over the top of the game rather than a line in it: an error must not push the whole table down. */
  position: fixed;
  top: calc((var(--hub-bar-height, 3.4rem) + 0.5rem) / var(--fit-zoom, 1)); /* the game may be scaled down to fit the window */
  left: calc(50vw / var(--fit-zoom, 1)); /* the middle of the window, however much the game is scaled */
  transform: translateX(-50%);
  z-index: 30;
  width: max-content;
  max-width: 40rem;
  margin: 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--danger);
  border-radius: 12px;
  background: var(--bg-raised);
  box-shadow: 0 4px 18px rgb(0 0 0 / 0.5);
  color: var(--danger);
}
</style>
