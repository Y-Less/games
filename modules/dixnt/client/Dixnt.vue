<script setup>
import { computed, onBeforeUnmount, provide } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { useLeave } from '../../../src/playBar.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { createStore } from './store.js';
import { DIXNT_KEY } from './useDixnt.js';
import Arena from './components/Arena.vue';
import HomeScreen from './components/HomeScreen.vue';
import Lightbox from './components/Lightbox.vue';
import LobbyView from './components/LobbyView.vue';
import WordPopup from './components/WordPopup.vue';
import { roundNumber } from './moveLog.js';
import { statusFor, styleName } from './status.js';

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
const results = computed(() => (state.value?.phase === 'results' ? state.value.results : null));
const nameOf = dixnt.nameOf;

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button: the way to get rid of someone who has gone away). The scoreboard's ids are the players' ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => state.value?.scoreboard.players ?? [],
  hostId: () => state.value?.hostId ?? null,
  isHost: () => isHost.value,
  remove: (targetId) => send('removePlayer', { targetId }, { quiet: true }),
});
const opened = computed(() => state.value?.players.find((p) => p.id === openId.value) ?? null);
const stageOf = (p) => {
  const phase = state.value.phase;
  if (p.waiting) return 'waiting for the next round';
  if (phase === 'word') return p.isChooser ? 'choosing the word' : 'waiting for the word';
  if (phase === 'picking') return p.hasPlayed ? 'has played a card' : 'still choosing a card';
  if (phase === 'voting') return p.hasVoted ? 'has voted' : 'still to vote';
  return p.isChooser ? 'the chooser' : '';
};
const status = computed(() => {
  const s = statusFor(state.value, { isHost: isHost.value });
  const away = state.value.players.filter((p) => !p.connected).map((p) => p.name);
  return away.length ? { ...s, lines: [...s.lines, { text: `Away: ${away.join(', ')}.`, tone: 'warn' }] } : s;
});
const word = computed(() => (state.value.wordHidden ? '???' : state.value.word));

// "Leave game" lives in the site's header, whenever you are in a game. Mid-game it asks first: a computer player takes
// over your seat if anyone else is still playing, otherwise your score is lost.
const takenOver = computed(() => Boolean(state.value) && !state.value.me.waiting && state.value.players.some((p) => !p.bot && p.id !== state.value.me.id));
useLeave({
  canLeave: computed(() => Boolean(state.value)),
  leave: async () => {
    await send('leave');
    goHome();
  },
  confirmText: computed(() => {
    if (!state.value || ['lobby', 'finished'].includes(state.value.phase)) return '';
    return takenOver.value ? 'A computer player will take over your seat and your score.' : 'Your score will be lost.';
  }),
});
</script>

<template>
  <div v-if="!store.checkedSession" class="splash muted">Connecting…</div>
  <HomeScreen v-else-if="!state" />

  <div v-else-if="state.phase === 'lobby'" class="game">
    <main class="stack"><LobbyView /></main>
  </div>

  <GameFrame v-else class="table-view" :main-span="12" :log-span="5">
    <template #scorebar>
      <ScoreBoard
        :players="state.scoreboard.players"
        :rounds="state.scoreboard.rounds"
        :low-is-better="state.scoreboard.lowIsBetter"
        :finished="state.phase === 'finished'"
        :sticky="false"
        v-bind="scoreProps"
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
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>Score</dt>
          <dd>{{ opened.score }}</dd>
          <dt>Turns as chooser</dt>
          <dd>{{ opened.turns }}</dd>
          <template v-if="stageOf(opened)">
            <dt>Now</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>
      <Arena :width="area.width" :height="area.height" />
    </template>

    <template #log>
      <GameLog :entries="store.log" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status.headline" :mine="status.mine" :turn="status.mine && Boolean(state.me?.isChooser)" :lines="status.lines">
        <template #facts>
          <strong v-if="state.phase === 'finished'">Game over</strong>
          <strong v-else>Round {{ roundNumber(state) }} of {{ state.totalRounds }}</strong>
          <span>{{ styleName(state.judging) }}</span>
          <span v-if="state.phase !== 'finished'">Chooser: {{ nameOf(state.chooserId) }}</span>
          <span v-if="word" class="word">Word: <strong>{{ word }}</strong></span>
          <span>Deck {{ state.drawCount }} / discard {{ state.discardCount }}</span>
          <span class="muted">Code {{ state.code }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>

  <Lightbox />
  <WordPopup v-if="state && state.phase !== 'lobby'" />

  <Teleport to="body">
    <div v-if="store.state && !store.connected" class="offline" role="status">Connection lost. Trying to reconnect…</div>
    <div v-if="store.state && store.toast" class="toast" role="status">{{ store.toast }}</div>
  </Teleport>
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
.summary {
  margin: 0 0 0.6rem;
  text-align: center;
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
