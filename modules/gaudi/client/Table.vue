<script setup>
// The Gaudi table, built on the standard GameFrame: the score bar on top; your window (large) with the draft pool, the
// round track, the tool cards and the objectives in the main area; the other players are chips in the score bar (click a name to see
// their window over the table); Recent moves and Status along the bottom. The server sends the view; every action is one
// request. This file only composes: the state lives in the use* composables and each part of the screen is its own component.
//
// Props: state (the server's view), send (function: (event, payload) -> Promise<{ ok, error }>).
// Emits: none. Side effects: sends requests (through the composables, and 'again' / 'undo' / 'end' from here).
import { computed, ref } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { useGameText } from '../../../src/useGameText.js';
import FinalResults from './FinalResults.vue';
import MovesLog from './MovesLog.vue';
import ObjectiveCards from './ObjectiveCards.vue';
import OpponentWindow from './OpponentWindow.vue';
import PlayerBoard from './PlayerBoard.vue';
import PrivateObjective from './PrivateObjective.vue';
import StatusFacts from './StatusFacts.vue';
import ToolCards from './ToolCards.vue';
import WindowsPhase from './WindowsPhase.vue';
import { tableSizes } from './layout.js';
import { useBoardClicks } from './useBoardClicks.js';
import { useOpenedPlayer } from './useOpenedPlayer.js';
import { useSelection } from './useSelection.js';
import { useStatusText } from './useStatusText.js';
import { useTools } from './useTools.js';
import { useTurnState } from './useTurnState.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t, error } = useGameText();

const board = ref(null); // the ScoreBoard, so the final screen's "See the scores" button can open its pop-up
const hint = ref(''); // what the tool or objective under the pointer does (shown in Status)

const s = computed(() => props.state); // the view as a computed, which is what every composable below takes
const turn = useTurnState(s);
const { windows, finished, me, myTurn, nameOf, poolMax, trackSlots, winners } = turn;
const sel = useSelection(s, turn.poolDie);
const { selected, mode, message } = sel;
const tools = useTools({ s, turn, sel, send: props.send });
const clicks = useBoardClicks({ s, turn, sel, applyTool: tools.applyTool, send: props.send });
const { status, statusLines } = useStatusText({ s, turn, sel, tools, hint });
const { scoreProps, popupProps, openedPlayer, openedSeat, openedIsMe } = useOpenedPlayer(s, props.send);

/**
 * The pool dice drawn as chosen: the one selected for placing, or the one chosen for the tool in use.
 * @returns {number[]} die ids (zero, one or two)
 * Side effects: none.
 */
const chosenIds = computed(() => [selected.value, mode.value?.die].filter((id) => id != null));

/**
 * Takes the whole turn back (server side) and clears any half-made choice on the screen.
 * @returns {Promise<void>} resolves when the server has answered
 * Side effects: sends 'undo'; clears the selection and tool; sets or clears the Status message.
 */
async function undoTurn() {
  const reply = await props.send('undo');
  sel.clear();
  message.value = reply.ok ? '' : error(reply);
}

/**
 * Ends your turn; shows the server's reason if it refuses.
 * @returns {Promise<void>} resolves when the server has answered
 * Side effects: sends 'end'; may set the Status message.
 */
async function endTurn() {
  const reply = await props.send('end');
  if (!reply.ok) message.value = error(reply);
}

/**
 * Works out every size on the table from the area the frame gives it (see layout.js).
 * @param {object} area  { width, height, left, columns, gap, mainSpan }
 * @returns {object} cell, die, perRow, poolHeight, trackDie, option and popup sizes in pixels
 * Side effects: none (called from the template, once per use, so keep it cheap and pure).
 */
const dims = (area) => tableSizes(area, { poolMax: poolMax.value, finished: finished.value, options: s.value.options?.length ?? 4 });
</script>

<template>
  <GameFrame class="table-view" :main-span="8">
    <template #scorebar>
      <ScoreBoard ref="board" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished" :sticky="false" :round-popups="false" v-bind="scoreProps">
        <template #round>
          <p v-if="!finished" class="provisional" role="note">
            <strong>{{ t('scores.provisionalTitle') }}</strong> {{ t('scores.provisionalText') }}
          </p>
          <p v-else class="provisional" role="note">{{ t('scores.finalNote') }}</p>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <OpponentWindow :popup-props="popupProps" :seat="openedSeat" :player="openedPlayer" :is-me="openedIsMe" :windows="windows" :cell="dims(area).popup" />

      <WindowsPhase v-if="windows" :state="state" :option-cell="dims(area).option" :send="send" @hint="hint = $event" />

      <div v-else class="arena">
        <div class="mine-col" :style="{ gridColumn: `span ${finished ? 4 : area.mainSpan}` }">
          <PlayerBoard
            :me="me"
            :my-turn="myTurn"
            :finished="finished"
            :grid="clicks.myGrid.value"
            :highlight="clicks.highlight.value"
            :pool="state.pool"
            :chosen-ids="chosenIds"
            :can-undo="Boolean(state.turn?.canUndo)"
            :mode="mode"
            :mode-die="tools.modeDie.value"
            :tool-params="tools.toolParams.value"
            :slots="trackSlots"
            :round="state.round"
            :sizes="dims(area)"
            @cell="clicks.clickCell"
            @pool="clicks.clickPool"
            @track="clicks.clickTrack"
            @end="endTurn"
            @undo="undoTurn"
            @cancel="mode = null"
            @apply="tools.applyTool"
          />
        </div>

        <div v-if="!finished" class="right-col" :style="{ gridColumn: `span ${area.columns - area.mainSpan}` }">
          <ToolCards :tools="state.tools" :active-id="mode?.id ?? null" :block-of="tools.toolBlock" @start="tools.startTool" @hint="hint = $event" />
          <ObjectiveCards :objectives="state.publicObjectives" @hint="hint = $event" />
          <PrivateObjective v-if="state.privateObjective" :colour="state.privateObjective.colour" :points="state.privateObjective.points" show-points :bad-private="Boolean(state.badPrivate)" @hint="hint = $event" />
        </div>

        <FinalResults v-if="finished && state.final" :state="state" :winners="winners" :style="{ gridColumn: `span ${area.columns - 4}` }" @again="send('again')" @scores="board.show()" />
      </div>
    </template>

    <template #log>
      <MovesLog :entries="state.log" :you="state.you" />
    </template>

    <template #status>
      <GameStatus :headline="status" :mine="(myTurn && !finished) || (windows && !state.chosen)" :lines="statusLines">
        <template #facts>
          <StatusFacts :state="state" :windows="windows" :finished="finished" :name-of="nameOf" />
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.provisional {
  margin: 0 0 0.6rem;
  padding: 0.5rem 0.8rem;
  border: 1px dashed var(--amber);
  border-radius: 10px;
}

/* ---- the table: your window and the pool on the left, the cards and objectives on the right ---- */
.arena {
  position: relative;
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  min-height: 0;
}
.mine-col,
.right-col {
  min-width: 0;
  min-height: 0;
}
.mine-col {
  display: flex;
}
.right-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}
</style>
