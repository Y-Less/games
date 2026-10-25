<script setup>
import { computed, onBeforeUnmount, provide } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { createStore } from './store.js';
import { DIXNT_KEY } from './useDixnt.js';
import Hand from './components/Hand.vue';
import HomeScreen from './components/HomeScreen.vue';
import FinishedPanel from './components/FinishedPanel.vue';
import Lightbox from './components/Lightbox.vue';
import LobbyView from './components/LobbyView.vue';
import PhasePanel from './components/PhasePanel.vue';
import PlayerBar from './components/PlayerBar.vue';
import ResultsPanel from './components/ResultsPanel.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, required: true },
  search: { type: String, default: '' },
  setSearch: { type: Function, required: true },
});

const dixnt = createStore({ socket: props.socket, user: props.user, search: props.search, setSearch: props.setSearch });
provide(DIXNT_KEY, dixnt);
onBeforeUnmount(() => dixnt.dispose());

const { store, isHost, send, goHome } = dixnt;
const state = computed(() => store.state);
// Skipped rounds don't count, so this follows the scoreboard's "Round N" labels.
const roundNumber = computed(() => Math.min(state.value.completedRounds + (state.value.phase === 'results' ? 0 : 1), state.value.totalRounds));
const results = computed(() => (state.value?.phase === 'results' ? state.value.results : null));
const nameOf = dixnt.nameOf;
const showHand = computed(() => ['word', 'picking'].includes(state.value?.phase));

async function leave() {
  if (!window.confirm('Leave the game? Your score will be lost.')) return;
  await send('leave');
  goHome();
}
async function endGame() {
  if (window.confirm('End the game and return everyone to the lobby? Scores are reset.')) await send('endGame');
}
async function skipRound() {
  if (window.confirm('Abandon this round (no points) and move on to the next word-chooser?')) await send('abortRound');
}
</script>

<template>
  <div v-if="!store.checkedSession" class="splash muted">Connecting…</div>
  <HomeScreen v-else-if="!state" />

  <div v-else class="game">
    <header>
      <InviteCode :code="state.code" />
      <span v-if="state.phase === 'finished'" class="muted round">Game over</span>
      <span v-else-if="state.phase !== 'lobby'" class="muted round">
        Round {{ roundNumber }} of {{ state.totalRounds }} · deck {{ state.drawCount }} / discard {{ state.discardCount }}
      </span>
      <div class="menu">
        <button v-if="isHost && ['word', 'picking', 'voting'].includes(state.phase)" class="quiet" @click="skipRound">
          Skip round
        </button>
        <button v-if="isHost && !['lobby', 'finished'].includes(state.phase)" class="quiet" @click="endGame">End game</button>
        <button class="quiet" @click="leave">Leave</button>
      </div>
    </header>

    <ScoreBoard
      v-if="state.phase !== 'lobby'"
      :players="state.scoreboard.players"
      :rounds="state.scoreboard.rounds"
      :low-is-better="state.scoreboard.lowIsBetter"
      :finished="state.phase === 'finished'"
    >
      <template #round>
        <p v-if="results" class="summary" role="status">
          <template v-if="results.judging === 'favourite'">{{ nameOf(state.chooserId) }} picked {{ nameOf(results.winnerId) }}’s card.</template>
          <template v-else>
            {{ nameOf(results.imposterId) }} was the imposter.
            {{ results.judging === 'chooser' ? (results.groupCorrect ? 'The chooser spotted them.' : 'The chooser was fooled.') : results.groupCorrect ? 'The group found them.' : 'The group was fooled.' }}
          </template>
        </p>
      </template>
    </ScoreBoard>

    <PlayerBar />

    <main class="stack">
      <LobbyView v-if="state.phase === 'lobby'" />
      <ResultsPanel v-else-if="state.phase === 'results'" />
      <FinishedPanel v-else-if="state.phase === 'finished'" />
      <PhasePanel v-else />
      <Hand v-if="showHand" />
    </main>

    <Teleport to="body">
      <div v-if="!store.connected" class="offline" role="status">Connection lost. Trying to reconnect…</div>
      <div v-if="store.toast" class="toast" role="status">{{ store.toast }}</div>
    </Teleport>
  </div>

  <Lightbox />
</template>

<style scoped>
.splash {
  display: grid;
  place-items: center;
  min-height: 30vh;
}
.game {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem 1rem;
}
.round {
  font-size: 0.9rem;
}
.summary {
  margin: 0 0 0.6rem;
  text-align: center;
}
.menu {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.toast,
.offline {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  max-width: 92vw;
  text-align: center;
}
.toast {
  bottom: 1.2rem;
  background: var(--parchment);
  color: #2a2418;
}
.offline {
  top: 0.8rem;
  background: var(--rust);
  color: #fff;
}
</style>
