<script setup>
// The Trivium table, for every part of a round: the score bar on top, the board (the wheel, then the question, then
// the reveal) filling the middle, and the two standard boxes along the bottom.  Nothing here waits on a button: the
// game moves itself on, so this file only draws what the server says is happening.
// Props: state (the server's view of the game), send (sends an action to the server), log (the recent moves).
// Emits: none.  Slots: none (it fills GameFrame's slots itself).
// Side effects: sends actions through `send`; opens and closes the scoreboard and player pop-ups.
import { computed, reactive } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import Board from './Board.vue';
import StatusPanel from './StatusPanel.vue';
import { useGameView } from './useGameView.js';
import { useReveal } from './useReveal.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] },
});
const { t, text } = useGameText();

// Each composable's refs are wrapped in reactive() so the template and the other components read them without .value.
// What the game looks like to you, and how far the reveal has got.
const view = reactive(useGameView(() => props.state));
const reveal = reactive(useReveal(() => props.state));

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button).  The scoreboard's ids are the players' own ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => props.state.scoreboard.players,
  hostId: () => props.state.hostId,
  isHost: () => props.state.you === props.state.hostId,
  remove: (id, player) => (player?.bot ? props.send('removeBot', { seat: id }) : props.send('kick', { userId: id })),
});
// The player whose pop-up is open, or null when none is.
const opened = computed(() => props.state.players.find((p) => p.id === openId.value) ?? null);
// What that player answered to the question just closed, if anything.
const openedAnswer = computed(() => props.state.result?.entries.find((entry) => entry.id === openId.value) ?? null);
/**
 * What the player whose pop-up is open is doing now.
 *
 * @param {object} player  a player from the view
 * @returns {string} what they are doing, or an empty string when there is nothing to say
 * Side effects: none.
 */
const stageOf = (player) => {
  if (!view.asking) return '';
  return player.answered ? t('popup.answered') : t('popup.thinking');
};
</script>

<template>
  <GameFrame class="table-view" :log-span="5">
    <template #scorebar>
      <ScoreBoard v-bind="scoreProps" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :finished="view.ended" :round-popups="false" :sticky="false" />
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <dt>{{ t('popup.colour') }}</dt>
          <dd><span class="chip" :style="{ background: opened.colour }" /></dd>
          <template v-if="stageOf(opened)">
            <dt>{{ t('popup.now') }}</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
          <template v-if="openedAnswer">
            <dt>{{ t('popup.answer') }}</dt>
            <dd>{{ state.question?.answers[openedAnswer.choice] ?? '' }}</dd>
            <dt>{{ t('popup.scored') }}</dt>
            <dd>{{ openedAnswer.points }}</dd>
          </template>
        </dl>
      </PlayerPopup>
      <Board :state="state" :view="view" :reveal="reveal" :area="area" :send="send" />
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingYet')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <StatusPanel :state="state" :view="view" :lit="reveal.answerShown" />
    </template>
  </GameFrame>
</template>

<style scoped>
.chip {
  display: inline-block;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  vertical-align: middle;
}
</style>
