<script setup>
// Tints and Hints: the screens drawn inside the site's play field. The server sends each player their own view of
// the game as a `state` event (null when not in a game); everything the player does is a request to the server.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { cellColour } from '../grid.js';
import Final from './Final.vue';
import Lobby from './Lobby.vue';
import Round from './Round.vue';

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
const kindText = { exact: 'Exactly right', close: 'Close', miss: 'Missed' };

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
  <div class="tints stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Tints and Hints"
      intro="Describe a secret colour, and see how close your friends can get. You get a code to share."
      :initial-code="initialCode"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <p v-if="notice" class="notice" role="alert">{{ notice }}</p>
      <!-- Lives here, not in Round or Final, so the pop-up that follows the last turn survives the change of screen. -->
      <ScoreBoard
        v-if="state.phase !== 'lobby'"
        :players="state.scoreboard.players"
        :rounds="state.scoreboard.rounds"
        :low-is-better="state.scoreboard.lowIsBetter"
        :finished="state.phase === 'finished'"
      >
        <template #round>
          <section v-if="state.result" class="reveal stack" aria-label="This turn">
            <div class="row">
              <span class="swatch" :style="{ background: cellColour(state.result.tint) }" role="img" :aria-label="`The tint was ${state.result.tint}`">{{ state.result.tint }}</span>
              <div class="stack">
                <strong>The tint was {{ state.result.tint }}.</strong>
                <span class="muted">{{ state.result.hinterName }} scores {{ state.result.hinterPoints }} for the hints.</span>
              </div>
            </div>
            <ul class="entries">
              <li v-for="(e, i) in state.result.entries" :key="i" class="row">
                <span class="name">{{ e.name }}</span>
                <span class="muted">round {{ e.round }}, {{ e.cell }}</span>
                <span :class="e.kind">{{ kindText[e.kind] }}</span>
                <strong>+{{ e.points }}</strong>
              </li>
            </ul>
          </section>
        </template>
      </ScoreBoard>
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Final v-else-if="state.phase === 'finished' || state.phase === 'abandoned'" :state="state" :send="send" />
      <Round v-else :state="state" :send="send" />
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
.reveal {
  margin-bottom: 0.8rem;
}
.swatch {
  display: grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  flex: none;
  border-radius: 12px;
  border: 2px solid var(--parchment);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 0 4px #000, 0 0 4px #000;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.name {
  font-weight: 600;
}
.exact {
  color: var(--moss);
}
.close {
  color: var(--amber);
}
.miss {
  color: var(--muted);
}
</style>
