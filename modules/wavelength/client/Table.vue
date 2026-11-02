<script setup>
// The Wavelength table, for every phase of a game: the score bar, the dial (big), the clue and guess controls beside
// it, slim bars for the other players, and the two standard boxes along the bottom. The psychic sees the hidden target
// and gives a clue, everyone else turns the dial to where they think it is, then the target is revealed.
// This file only composes: what the game looks like to you is in useGameView.js, clueing and guessing in useGuessing.js,
// the words in useStatusText.js, and each area of the screen is its own component.
// Props: state (the server's view of the game), send (sends an action to the server, resolves with its reply), log (the
//   recent moves, as lines of text).
// Emits: none. Slots: none (it fills GameFrame's slots itself).
// Side effects: sends actions through `send`; opens and closes the scoreboard and player pop-ups.
import { computed, reactive } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useGameText } from '../../../src/useGameText.js';
import DialArea from './DialArea.vue';
import PlayerBars from './PlayerBars.vue';
import PlayerFacts from './PlayerFacts.vue';
import ScoreBar from './ScoreBar.vue';
import SidePanel from './SidePanel.vue';
import StatusPanel from './StatusPanel.vue';
import { dialLayout } from './layout.js';
import { useGameView } from './useGameView.js';
import { useGuessing } from './useGuessing.js';
import { useStatusText } from './useStatusText.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] },
});
const { t, text } = useGameText();

// Each composable's returned refs are wrapped in reactive() so the template and the other composables read them without .value.
// The game view: read-only facts about the game for this player.
const view = reactive(useGameView(() => props.state));
// Clueing and guessing: the dial position being turned, the clue being typed and what is sent.
const guess = reactive(useGuessing(view, props.send));
// The Status box's words.
const { headline, mineNow, lines } = useStatusText(view, guess);

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button). The scoreboard's ids are the accounts' ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => props.state.scoreboard.players,
  hostId: () => props.state.hostId,
  isHost: () => props.state.you === props.state.hostId,
  remove: (id, player) => (player?.bot ? props.send('removeBot', { seat: id }) : props.send('kick', { userId: id })),
});
// The player whose pop-up is open, or null when none is.
const opened = computed(() => props.state.players.find((p) => p.id === openId.value) ?? null);
/**
 * What another player is doing now, for their pop-up.
 *
 * @param {object} p  a player from the view
 * @returns {string} what they are doing, or an empty string when there is nothing to say
 *
 * Side effects: none.
 */
const stageOf = (p) => {
  if (view.ended) return '';
  if (p.id === props.state.psychic) return t('popup.stagePsychic');
  if (view.guessing) return p.guessed ? t('popup.hasGuessed') : t('popup.stillToGuess');
  return '';
};
</script>

<template>
  <GameFrame class="table-view" :main-span="8" :log-span="5">
    <template #scorebar>
      <ScoreBar :state="state" :view="view" v-bind="scoreProps" @ready="send('ready')" />
    </template>

    <template #main="area">
      <PlayerFacts :popup-props="popupProps" :opened="opened" :stage="opened ? stageOf(opened) : ''" />
      <div class="arena" :class="{ stacked: dialLayout(area).span === area.columns }">
        <DialArea
          :state="state"
          :markers="guess.markers"
          :needle="guess.needle"
          :colour="view.team ? guess.TEAM_MARKER : (view.mine?.colour ?? guess.TEAM_MARKER)"
          :interactive="view.canGuess"
          :width="dialLayout(area).width"
          :span="dialLayout(area).span"
          @pick="guess.turn"
        />
        <SidePanel :state="state" :view="view" :guess="guess" :span="area.columns - (dialLayout(area).span === area.columns ? 0 : dialLayout(area).span)" />
      </div>
    </template>

    <template #others>
      <PlayerBars :players="view.others" :psychic="state.psychic" :ended="view.ended" :guessing="view.guessing" :team="view.team" />
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingYet')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <StatusPanel :headline="headline" :mine="mineNow" :turn="view.clueTime && view.isPsychic" :lines="lines" :state="state" :ended="view.ended" :psychic-name="view.psychicName" />
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  min-height: 0;
  align-content: start;
  gap: 0.6rem 0;
}
</style>
