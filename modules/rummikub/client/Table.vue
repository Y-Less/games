<script setup>
// The play field, in the standard frame: the score bar on top; the table of sets (wide) with your rack, the New set
// area and the turn buttons directly under it; and the two boxes along the bottom, Recent moves and Status. Everything
// that is said (whose turn it is, the round, the pool, the first-meld target, the live check of your layout) is in Status,
// so nothing in the play area grows, shrinks or moves while the game is played.
// The table is a list of sets; your rack sits below. During your turn you build a working copy of the table (move tiles by
// dragging them, or by clicking tiles and then clicking where they should go) and press End turn, which sends the whole
// layout to the server; the server makes the same check as the buttons here and answers with the new state, or refuses
// and leaves everything as it was. Undo and Reset turn only touch the working copy.
// This file only composes: the working copy, dragging, the timer, the sent actions and the words are in the use*.js files,
// and each area of the screen is its own component.
// Props: state (the server's view of the game), send (sends an action to the server, resolves with its reply).
// Emits: none. Slots: none (it fills GameFrame's slots itself).
// Side effects: sends actions through `send`; opens and closes the scoreboard and player pop-ups.
import { computed, reactive } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import PlayerFacts from './PlayerFacts.vue';
import RackPanel from './RackPanel.vue';
import ScoreBar from './ScoreBar.vue';
import StatusPanel from './StatusPanel.vue';
import TableFelt from './TableFelt.vue';
import TurnActions from './TurnActions.vue';
import { useRoundView } from './useRoundView.js';
import { useStatusText } from './useStatusText.js';
import { useTileDrag } from './useTileDrag.js';
import { useTurnActions } from './useTurnActions.js';
import { useTurnClock } from './useTurnClock.js';
import { useWorkingCopy } from './useWorkingCopy.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

// Each composable's returned refs are wrapped in reactive() so the template and the other composables read them without .value.
// The round view: read-only facts about the game for this player.
const view = reactive(useRoundView(() => props.state));
// The working copy of the table that you build during your turn.
const copy = reactive(useWorkingCopy(view));
// Mouse drag and drop of tiles.
const drag = reactive(useTileDrag(view, copy));
// The things sent to the server: end turn, draw, carry on.
const actions = reactive(useTurnActions(view, copy, props.send));
// The turn countdown (null when untimed).
const { secondsLeft } = useTurnClock(() => props.state);
// The Status box's words.
const { headline, lines } = useStatusText(view, copy);

// Another player's details (their tile count and so on) open from their chip in the score bar: one at a time, floating
// over the top of the main area so that nothing moves.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => view.scorePlayers,
  hostId: () => props.state.hostSeat,
  isHost: () => view.isHost,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
// The seat view of the player whose pop-up is open, or null when none is.
const opened = computed(() => props.state.seats.find((o) => o && o.seat === openId.value) ?? null); // yours too: your own summary
// The score of the player whose pop-up is open (0 when none is).
const openedScore = computed(() => props.state.scoreboard.players.find((p) => p.id === openId.value)?.score ?? 0);

/**
 * The rack's rows follow the room the frame leaves (a larger window shows more of it), never what is in it.
 *
 * @param {object} area  the frame's slot area
 * @returns {number} how many rows of tiles the rack shows (3 when the area is at least 600px tall, otherwise 2)
 *
 * Side effects: none.
 */
const rackRows = (area) => (area.height >= 600 ? 3 : 2);
</script>

<template>
  <GameFrame class="table-view" :main-span="9">
    <template #scorebar>
      <ScoreBar :state="state" :settings="view.s" :players="view.scorePlayers" :finished="view.finished" :awaiting="view.between && !view.youReady" :waiting="view.waitingNames" v-bind="scoreProps" @continue="actions.onContinue" />
    </template>

    <template #main="area">
      <div class="arena" :style="{ '--rack-rows': rackRows(area) }">
        <PlayerFacts :popup-props="popupProps" :opened="opened" :score="openedScore" :playing="state.phase === 'playing'" :turn="state.turn" />
        <TableFelt
          :sets="copy.shownSets"
          :settings="view.s"
          :selected="copy.selected"
          :my-turn="view.myTurn"
          :drop-hint="drag.dropHint"
          :fresh="copy.fresh"
          :recent="copy.recent"
          :locked-tile="copy.lockedTile"
          :stands="copy.stands"
          :can-add-to="copy.canAddTo"
          @pick="copy.pick"
          @drop-selected="copy.dropSelected"
          @drop-tiles="drag.drop"
          @drag-start-tile="drag.dragStart"
          @drag-end-tile="drag.dragEnd"
        />
        <RackPanel
          v-model:sort-mode="copy.sortMode"
          :tiles="copy.rackTiles"
          :count="copy.arr.rack.length"
          :settings="view.s"
          :selected="copy.selected"
          :my-turn="view.myTurn"
          :drawn="state.drawn"
          :playing="state.phase === 'playing'"
          :span="area.mainSpan"
          @pick="copy.pick"
          @drop-selected="copy.dropSelected"
          @drop-tiles="drag.drop"
          @drag-start-tile="drag.dragStart"
          @drag-end-tile="drag.dragEnd"
        />
        <TurnActions
          :my-turn="view.myTurn"
          :targeting="copy.selected.length > 0"
          :can-undo="copy.undoStack.length > 0"
          :changed="copy.changed"
          :busy="actions.busy"
          :pool-count="state.poolCount"
          :can-end="actions.canEnd"
          @drop-selected="copy.dropSelected"
          @drop-tiles="drag.drop"
          @undo="copy.undo"
          @reset="copy.reset"
          @draw="actions.drawTile"
          @end="actions.endTurn"
        />
      </div>
    </template>

    <template #log>
      <GameLog :entries="state.log" newest-first :fresh="4" empty="Nothing has been played yet." v-slot="{ entry }">{{ entry.text }}</GameLog>
    </template>

    <template #status>
      <StatusPanel
        :headline="headline"
        :mine="view.myTurn && !view.finished"
        :lines="lines"
        :round="state.round"
        :rounds="view.s.rounds"
        :pool-count="state.poolCount"
        :meld="view.s.meld"
        :show-points="!view.melded && state.you !== -1"
        :points="copy.status.points"
        :seconds-left="secondsLeft"
        :finished="view.finished"
        :is-host="view.isHost"
        @again="send('again')"
      />
    </template>
  </GameFrame>
</template>

<style scoped>
/* No slim bars: the frame has three rows (score bar, table, bottom boxes). */
.game-frame.table-view {
  grid-template-rows: auto minmax(0, 1fr) clamp(6.5rem, 22%, 13rem);
}
.arena {
  grid-column: 1 / -1;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: subgrid;
  grid-template-rows: minmax(0, 1fr) auto;
  row-gap: 8px;
}
</style>
