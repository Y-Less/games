<script setup>
// A Dixnt game under way, in the standard frame: the score bar, the play area (Arena), the Recent moves, and the
// Status box.  It also owns the player pop-up.  Dixnt has no "It's your turn" pop-up: everybody but the chooser plays
// at once, so there is no turn to announce.
//
// Props: none (everything comes from the store, see ../store.js).  Emits: none.
// Slots: none (fills GameFrame's scorebar, main, log, and status slots).
// Side effects: sends `kick` / `removeBot` (the host's Remove) and the vote-to-remove events, through the store.
import { computed } from 'vue';
import GameFrame from '../../../../src/components/GameFrame.vue';
import GameLog from '../../../../src/components/GameLog.vue';
import GameStatus from '../../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../../src/components/ScoreBoard.vue';
import { useGameText } from '../../../../src/useGameText.js';
import { usePlayerPopup } from '../../../../src/usePlayerPopup.js';
import { roundNumber, turnNumber } from '../moveLog.js';
import { statusFor, styleName } from '../status.js';
import { useDixnt } from '../useDixnt.js';
import Arena from './Arena.vue';

const { t, text, list } = useGameText();
const { store, isHost, send, nameOf } = useDixnt();
// The current personalised state (never null here: this is drawn only inside a game).
const state = computed(() => store.state);
// The results of the turn while they are on show, else null.
const results = computed(() => (state.value.phase === 'results' ? state.value.results : null));

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button: the way to get rid of someone who has gone away).  Removing a player, and the vote about one, are the same
// words in every game (usePlayerPopup).
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => state.value.scoreboard.players,
  hostId: () => state.value.hostId,
  isHost: () => isHost.value,
  send,
  vote: () => state.value.vote ?? null,
});
// The player whose pop-up is open, or null.
const opened = computed(() => state.value.players.find((p) => p.id === openId.value) ?? null);
// Returns what a player is doing in this phase, in words, for their pop-up ('' if nothing to say).
const stageOf = (p) => {
  const phase = state.value.phase;
  if (phase === 'word') return t(p.isChooser ? 'popup.choosingWord' : 'popup.waitingForWord');
  if (phase === 'picking') return p.plays ? t(p.hasPlayed ? 'popup.hasPlayed' : 'popup.stillChoosing') : t('popup.theChooser');
  if (phase === 'voting') return t(p.hasVoted ? 'popup.hasVoted' : 'popup.stillToVote');
  return p.isChooser ? t('popup.theChooser') : '';
};
// How the turn turned out, over the scores: whether the chooser's own guess was right, or whether the group's was.
const verdict = computed(() => {
  const right = results.value?.groupCorrect;
  if (results.value?.judging === 'chooser') return t(right ? 'reveal.chooserSpotted' : 'reveal.chooserFooled');
  return t(right ? 'reveal.groupFound' : 'reveal.groupFooled');
});
// Whether the pop-up shows how many turns a player has had as the chooser: with no chooser, nobody has had any, and
// the count the game keeps is only how it knows when it is over.
const showTurns = computed(() => !state.value.noChooser);
// The Status box content: the phase's messages from status.js put into words, plus a warning line naming anyone who
// is away.  GameStatus wants strings, so every message is translated here, where the game's locale file is in reach.
const status = computed(() => {
  const s = statusFor(state.value, { isHost: isHost.value });
  const away = state.value.players.filter((p) => !p.online).map((p) => p.name);
  const lines = s.lines.map((line) => (line?.tone ? { text: text(line.text), tone: line.tone } : text(line)));
  if (away.length) lines.push({ text: t('status.away', { names: list(away) }), tone: 'warn' });
  return { headline: text(s.headline), mine: s.mine, lines };
});
// The word as this viewer sees it: the stand-in for the one player kept in the dark.
const word = computed(() => (state.value.wordHidden ? t('table.hiddenWord') : state.value.word));
// The scoreboard adds a row every turn, but a turn is one player's go: stopping the table to close a pop-up after
// each of them is four interruptions a round at a table of four.  So the pop-up is held back for the turn that closes
// a round — everybody has had a go, and the scores are worth reading — and for the end of the game.  The "All rounds"
// button opens it at any time, as everywhere else on the site.
const scoresWorthStopping = computed(() => Boolean(state.value.results?.roundOver) || state.value.phase === 'finished');
</script>

<template>
  <GameFrame class="table-view" :main-span="12" :log-span="5">
    <template #scorebar>
      <ScoreBoard
        :players="state.scoreboard.players"
        :rounds="state.scoreboard.rounds"
        :low-is-better="state.scoreboard.lowIsBetter"
        :finished="state.phase === 'finished'"
        :auto-open="scoresWorthStopping"
        :sticky="false"
        v-bind="scoreProps"
      >
        <template #round>
          <p v-if="results" class="summary" role="status">
            <template v-if="results.judging === 'favourite'">{{ t('reveal.favourite', { chooser: nameOf(state.chooserId), winner: nameOf(results.winnerId) }) }}</template>
            <template v-else>
              {{ t('reveal.imposter', { name: nameOf(results.imposterId) }) }}
              {{ verdict }}
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
          <template v-if="showTurns">
            <dt>{{ t('popup.turns') }}</dt>
            <dd>{{ opened.turns }}</dd>
          </template>
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
          <strong v-else>{{ t('facts.turn', { n: turnNumber(state), total: state.totalTurns }) }}</strong>
          <span v-if="state.phase !== 'finished'">{{ t('facts.round', { n: roundNumber(state), total: state.rounds }) }}</span>
          <span>{{ text(styleName(state.judging)) }}</span>
          <span v-if="state.noChooser">{{ t('judging.noChooserShort') }}</span>
          <span v-if="state.phase !== 'finished' && state.chooserId !== null">{{ t('facts.chooser', { name: nameOf(state.chooserId) }) }}</span>
          <span v-if="word" class="word">{{ t('facts.word', { word }) }}</span>
          <span>{{ t('facts.deck', { draw: state.drawCount, discard: state.discardCount }) }}</span>
          <span class="muted">{{ t('facts.code', { code: state.code }) }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.summary {
  margin: 0 0 0.6rem;
  text-align: center;
}
</style>
