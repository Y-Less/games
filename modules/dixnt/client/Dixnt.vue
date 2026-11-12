<script setup>
// Dixnt: the root component.  It creates the game store (see store.js) and provides it to every component below, then
// chooses the screen: the start screen, the lobby, or the table (in the standard GameFrame, with the score bar, the
// play area, the Recent moves, and the Status box).  Also owns the player pop-up, the pop-up that tells the player
// who was kept in the dark what the word was, and the "Leave game" button's behaviour.  Dixnt has no "It's your turn"
// pop-up: everybody but the chooser plays at once, so there is no turn to announce.
//
// Props:
//   socket     {Object}    required.  The platform's socket connection for this game.
//   user       {Object}    required.  The signed-in user.
//   search     {string}    the page's current query string, used to pick up an invite code.
//   setSearch  {Function}  required.  Updates the page's query string (puts the game code in the address bar).
// Emits: none.
// Slots: none (fills GameFrame's scorebar, main, log, and status slots).
// Side effects: creates the store, whose shared plumbing (src/useGameSocket.js) listens to the socket and registers
// the site's "Leave game" button for the life of this component; provides the store under DIXNT_KEY; sends
// `create`, `join`, `kick`/`removeBot` (the host's Remove) and the vote-to-remove events.
import { computed, provide } from 'vue';
import ErrorToast from '../../../src/components/ErrorToast.vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import YourTurnPopup from '../../../src/components/YourTurnPopup.vue';
import { useGameText } from '../../../src/useGameText.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { createStore } from './store.js';
import { DIXNT_KEY } from './useDixnt.js';
import Arena from './components/Arena.vue';
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

const { t, text, list } = useGameText();
// "Leave game" lives in the site's header, whenever you are in a game.  Mid-game it asks first: a computer player
// takes your place if anyone else is still playing, otherwise the game goes with you.
// @param {object} view  the current state; @returns {string} the warning, or '' when leaving is harmless.  No side effects.
const leaveConfirm = (view) => {
  if (['lobby', 'finished'].includes(view.phase)) return '';
  return t(view.players.some((p) => !p.bot && p.id !== view.me.id) ? 'leave.takenOver' : 'leave.scoreLost');
};
const dixnt = createStore({ socket: props.socket, user: props.user, search: props.search, setSearch: props.setSearch, leaveConfirm });
provide(DIXNT_KEY, dixnt);

const { store, isHost, send, busy, initialCode } = dixnt;
// The current personalised state (null when not in a game).
const state = computed(() => store.state);
// The results of the round while they are on show, else null.
const results = computed(() => (state.value?.phase === 'results' ? state.value.results : null));
// Returns a player's name by id.
const nameOf = dixnt.nameOf;

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button: the way to get rid of someone who has gone away).  A person's id in the game is their account id, and a
// computer player's is its own, so removing one is `kick` and the other `removeBot`.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => state.value?.scoreboard.players ?? [],
  hostId: () => state.value?.hostId ?? null,
  isHost: () => isHost.value,
  // Dixnt sends everything quietly, so it writes these out rather than taking usePlayerPopup's `send` versions.
  remove: (id, player) => send(player?.bot ? 'removeBot' : 'kick', { slot: player?.slot }, { quiet: true }),
  // Anybody may ask the rest of the table to remove a player; the vote itself is shared (shared/voteKick.js).
  vote: () => state.value?.vote ?? null,
  askVote: (id, player) => send('voteKick', { slot: player?.slot }, { quiet: true }),
  answerVote: (agree) => send('voteAnswer', { agree }, { quiet: true }),
  dropVote: () => send('voteDrop', {}, { quiet: true }),
});
// The player whose pop-up is open, or null.
const opened = computed(() => state.value?.players.find((p) => p.id === openId.value) ?? null);
// Returns what a player is doing in this phase, in words, for their pop-up ('' if nothing to say).
const stageOf = (p) => {
  const phase = state.value.phase;
  if (phase === 'word') return t(p.isChooser ? 'popup.choosingWord' : 'popup.waitingForWord');
  if (phase === 'picking') return t(p.hasPlayed ? 'popup.hasPlayed' : 'popup.stillChoosing');
  if (phase === 'voting') return t(p.hasVoted ? 'popup.hasVoted' : 'popup.stillToVote');
  return p.isChooser ? t('popup.theChooser') : '';
};
// The Status box content: the phase's messages from status.js put into words, plus a warning line naming anyone who
// is away.  GameStatus wants strings, so every message is translated here, where the game's locale file is in reach.
const status = computed(() => {
  const s = statusFor(state.value, { isHost: isHost.value });
  const away = state.value.players.filter((p) => !p.connected).map((p) => p.name);
  const lines = s.lines.map((line) => (line?.tone ? { text: text(line.text), tone: line.tone } : text(line)));
  if (away.length) lines.push({ text: t('status.away', { names: list(away) }), tone: 'warn' });
  return { headline: text(s.headline), mine: s.mine, lines };
});
// The word as this viewer sees it: the stand-in for the one player kept in the dark.
const word = computed(() => (state.value.wordHidden ? t('table.hiddenWord') : state.value.word));
// Nobody in Dixnt is told it is their turn: everybody plays at once, and the chooser has the whole table waiting on
// them anyway.  The one small pop-up left is for the player who was kept in the dark, who is let in on the word as
// the voting opens ({ word, key } from the store, or null when there is nothing to tell).
const imposterWord = computed(() => store.imposterWord);

</script>

<template>
  <div v-if="!store.loaded" class="splash muted">{{ $t('play.connecting') }}</div>
  <RoomEntry
    v-else-if="!state"
    :noun="t('entry.noun')"
    :intro="t('entry.intro', { name: user.displayName })"
    :initial-code="initialCode"
    :busy="busy"
    :error="store.notice"
    @create="send('create')"
    @join="(code) => send('join', { code })"
  />

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
      <GameStatus :headline="status.headline" :mine="status.mine" :popup="false" :lines="status.lines">
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
  <YourTurnPopup v-if="imposterWord" :key="imposterWord.key" :active="true" :message="t('table.imposterWord', { word: imposterWord.word })" />

  <ErrorToast v-if="state && store.notice" :text="store.notice" />
  <Teleport to="body">
    <div v-if="state && !store.connected" class="offline" role="status">{{ t('table.offline') }}</div>
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
.offline {
  position: fixed;
  top: 0.8rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  max-width: 92vw;
  text-align: center;
  background: var(--rust);
  color: #fff;
}
</style>
