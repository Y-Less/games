<script setup>
// Dixnt: the root component. It creates the game store (see store.js) and provides it to every component below, then
// chooses the screen: the start screen, the lobby, or the table (in the standard GameFrame, with the score bar, the
// play area, the Recent moves and the Status box). Also owns the player pop-up and the "Leave game" button's behaviour.
//
// Props:
//   socket     {Object}    required. The platform's socket connection for this game.
//   user       {Object}    required. The signed-in user.
//   search     {string}    the page's current query string, used to pick up an invite code.
//   setSearch  {Function}  required. Updates the page's query string (puts the game code in the address bar).
// Emits: none.
// Slots: none (fills GameFrame's scorebar, main, log and status slots).
// Side effects: creates the store, which listens to the socket (detached when this component unmounts); provides the
// store under DIXNT_KEY; sends `removePlayer` (host's Remove) and `leave` requests; registers the site's leave button.
import { computed, onBeforeUnmount, provide } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { useLeave } from '../../../src/playBar.js';
import { useGameText } from '../../../src/useGameText.js';
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

const { t, text, error, list } = useGameText();
// The store answers a refusal with words, so it is given the game's own error helper (it is not a component itself).
const dixnt = createStore({ socket: props.socket, user: props.user, search: props.search, setSearch: props.setSearch, error });
provide(DIXNT_KEY, dixnt);
onBeforeUnmount(() => dixnt.dispose());

const { store, isHost, send, goHome } = dixnt;
// The current personalised state (null when not in a game).
const state = computed(() => store.state);
// The results of the round while they are on show, else null.
const results = computed(() => (state.value?.phase === 'results' ? state.value.results : null));
// Returns a player's name by id.
const nameOf = dixnt.nameOf;

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button: the way to get rid of someone who has gone away). The scoreboard's ids are the players' ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => state.value?.scoreboard.players ?? [],
  hostId: () => state.value?.hostId ?? null,
  isHost: () => isHost.value,
  remove: (targetId) => send('removePlayer', { targetId }, { quiet: true }),
});
// The player whose pop-up is open, or null.
const opened = computed(() => state.value?.players.find((p) => p.id === openId.value) ?? null);
// Returns what a player is doing in this phase, in words, for their pop-up ('' if nothing to say).
const stageOf = (p) => {
  const phase = state.value.phase;
  if (p.waiting) return t('popup.waiting');
  if (phase === 'word') return t(p.isChooser ? 'popup.choosingWord' : 'popup.waitingForWord');
  if (phase === 'picking') return t(p.hasPlayed ? 'popup.hasPlayed' : 'popup.stillChoosing');
  if (phase === 'voting') return t(p.hasVoted ? 'popup.hasVoted' : 'popup.stillToVote');
  return p.isChooser ? t('popup.theChooser') : '';
};
// The Status box content: the phase's messages from status.js put into words, plus a warning line naming anyone who
// is away. GameStatus wants strings, so every message is translated here, where the game's locale file is in reach.
const status = computed(() => {
  const s = statusFor(state.value, { isHost: isHost.value });
  const away = state.value.players.filter((p) => !p.connected).map((p) => p.name);
  const lines = s.lines.map((line) => (line?.tone ? { text: text(line.text), tone: line.tone } : text(line)));
  if (away.length) lines.push({ text: t('status.away', { names: list(away) }), tone: 'warn' });
  return { headline: text(s.headline), mine: s.mine, lines };
});
// The word as this viewer sees it: the stand-in for the one player kept in the dark.
const word = computed(() => (state.value.wordHidden ? t('table.hiddenWord') : state.value.word));

// "Leave game" lives in the site's header, whenever you are in a game. Mid-game it asks first: a computer player takes
// over your seat if anyone else is still playing, otherwise your score is lost.
// True when leaving would hand the seat to a computer player (another human is still playing), rather than lose the score.
const takenOver = computed(() => Boolean(state.value) && !state.value.me.waiting && state.value.players.some((p) => !p.bot && p.id !== state.value.me.id));
useLeave({
  canLeave: computed(() => Boolean(state.value)),
  leave: async () => {
    await send('leave');
    goHome();
  },
  confirmText: computed(() => {
    if (!state.value || ['lobby', 'finished'].includes(state.value.phase)) return '';
    return t(takenOver.value ? 'leave.takenOver' : 'leave.scoreLost');
  }),
});
</script>

<template>
  <div v-if="!store.checkedSession" class="splash muted">{{ $t('play.connecting') }}</div>
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
            <template v-if="results.judging === 'favourite'">{{ t('reveal.favourite', { chooser: nameOf(state.chooserId), winner: nameOf(results.winnerId) }) }}</template>
            <template v-else>
              {{ t('reveal.imposter', { name: nameOf(results.imposterId) }) }}
              {{ t(results.judging === 'chooser' ? (results.groupCorrect ? 'reveal.chooserSpotted' : 'reveal.chooserFooled') : results.groupCorrect ? 'reveal.groupFound' : 'reveal.groupFooled') }}
            </template>
          </p>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>{{ t('popup.score') }}</dt>
          <dd>{{ opened.score }}</dd>
          <dt>{{ t('popup.turns') }}</dt>
          <dd>{{ opened.turns }}</dd>
          <template v-if="stageOf(opened)">
            <dt>{{ t('popup.now') }}</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>
      <Arena :width="area.width" :height="area.height" />
    </template>

    <template #log>
      <GameLog :entries="store.log" newest-first :fresh="4" :empty="t('table.nothingPlayed')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="status.headline" :mine="status.mine" :turn="status.mine && Boolean(state.me?.isChooser)" :lines="status.lines">
        <template #facts>
          <strong v-if="state.phase === 'finished'">{{ t('facts.gameOver') }}</strong>
          <strong v-else>{{ t('facts.round', { n: roundNumber(state), total: state.totalRounds }) }}</strong>
          <span>{{ text(styleName(state.judging)) }}</span>
          <span v-if="state.phase !== 'finished'">{{ t('facts.chooser', { name: nameOf(state.chooserId) }) }}</span>
          <span v-if="word" class="word">{{ t('facts.word', { word }) }}</span>
          <span>{{ t('facts.deck', { draw: state.drawCount, discard: state.discardCount }) }}</span>
          <span class="muted">{{ t('facts.code', { code: state.code }) }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>

  <Lightbox />
  <WordPopup v-if="state && state.phase !== 'lobby'" />

  <Teleport to="body">
    <div v-if="store.state && !store.connected" class="offline" role="status">{{ t('table.offline') }}</div>
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
