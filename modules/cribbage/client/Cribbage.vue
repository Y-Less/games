<script setup>
// Cribbage: the screens drawn inside the site's play field. The server sends each player their own view of the game
// as a `state` event (null when not in a game); everything the player does is a request to the server.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import Board from './Board.vue';
import Lobby from './Lobby.vue';
import ShowHands from './ShowHands.vue';
import Table from './Table.vue';
import { seatColour } from './colours.js';

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
let invite = props.search.replace(/^\?/, '');

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

async function run(event, payload) {
  busy.value = true;
  await send(event, payload);
  busy.value = false;
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

const phase = computed(() => state.value?.phase);
const me = computed(() => state.value?.seats[state.value.you]);
const dealer = computed(() => state.value?.seats[state.value.dealer]);
const finished = computed(() => phase.value === 'finished');
const winner = computed(() => (finished.value ? state.value.seats[state.value.winner] : null));
const standings = computed(() =>
  finished.value ? state.value.seats.map((s) => ({ ...s, place: state.value.placements[s.seat] })).sort((a, b) => a.place - b.place || b.score - a.score) : [],
);
const skunked = computed(() => finished.value && state.value.seats.filter((s) => s.seat !== state.value.winner && s.score < state.value.skunkLine));
const scorePlayers = computed(() => state.value.scoreboard.players.map((p) => (phase.value === 'show' ? { ...p, ready: Boolean(state.value.seats[p.id]?.ready) } : p)));
const waitingForReady = computed(() => (phase.value === 'show' ? state.value.seats.filter((s) => !s.ready).map((s) => s.name) : []));
</script>

<template>
  <div class="cribbage stack">
    <p v-if="loaded && state && notice" class="notice" role="alert">{{ notice }}</p>
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry v-else-if="!state" noun="game" intro="Cribbage for two to four players, with computer players to fill any empty seat." :busy="busy" :error="notice" :initial-code="search.replace(/^\?/, '')" @create="run('create')" @join="(code) => run('join', { code })" />

    <template v-else>
      <header class="head">
        <InviteCode :code="state.code" />
        <span v-if="phase !== 'lobby'" class="muted info">Hand {{ state.handNo }} · {{ dealer.name }} deals · first to {{ state.target }}</span>
        <button v-if="phase !== 'lobby'" class="quiet leave" @click="send('leave')">Leave</button>
      </header>

      <Lobby v-if="phase === 'lobby'" :state="state" :send="send" />

      <template v-else>
        <ScoreBoard :players="scorePlayers" :rounds="state.scoreboard.rounds" :target="state.target" :finished="finished" :awaiting="phase === 'show' && !me.ready" :waiting="waitingForReady" running @continue="send('ready')">
          <template #round>
            <ShowHands v-if="state.show" :state="state" class="in-modal" />
          </template>
        </ScoreBoard>

        <Board :seats="state.seats" :target="state.target" :skunk-line="state.skunkLine" :you="state.you" />

        <section v-if="finished" class="panel stack final">
          <h2>{{ winner.name }}{{ winner.seat === state.you ? ' (you)' : '' }} wins!</h2>
          <ol class="places">
            <li v-for="s in standings" :key="s.seat" class="row">
              <strong class="place">{{ s.place }}</strong>
              <span class="chip" :style="{ background: seatColour(s.seat) }" />
              <span class="name">{{ s.name }}<span v-if="s.seat === state.you" class="muted"> (you)</span></span>
              <strong>{{ s.score }}</strong>
            </li>
          </ol>
          <p v-if="skunked.length" class="muted">Skunk! {{ skunked.map((s) => s.name).join(' and ') }} finished below {{ state.skunkLine }}.</p>
          <div class="row">
            <button v-if="state.isHost" class="primary" @click="send('rematch')">Play again (back to the lobby)</button>
            <span v-else class="muted">The host can start another game.</span>
            <button class="quiet" @click="send('leave')">Leave</button>
          </div>
        </section>

        <Table v-if="phase === 'discard' || phase === 'play'" :state="state" :send="send" />

        <section v-if="phase === 'show'" class="panel stack">
          <h2>The show</h2>
          <p class="muted">{{ me.ready ? `Waiting for ${waitingForReady.join(', ')}…` : 'Close the scores pop-up when you are ready for the next hand.' }}</p>
        </section>

        <details v-if="finished && state.show" class="panel">
          <summary>The last show</summary>
          <ShowHands :state="state" />
        </details>
      </template>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
}
.leave {
  margin-left: auto;
}
.info {
  font-size: 0.9rem;
}
.notice {
  margin: 0;
  color: var(--danger);
}
.places {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.place {
  width: 1.5rem;
  text-align: center;
}
.chip {
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  flex: none;
}
.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.final h2 {
  color: var(--amber);
}
.in-modal {
  margin-bottom: 0.8rem;
}
</style>
