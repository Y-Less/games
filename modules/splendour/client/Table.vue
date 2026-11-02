<script setup>
// The table: a thin composer on the standard frame. The score bar, the market (nobles and cards), your board with the gem
// supply, the other players' pop-up, the log and the Status box are components; what you are choosing (gems, a card, tokens
// to return) lives in the use*.js composables beside them.
// Props: state (the server's view of the game), send (sends an action to the server, resolves with its reply).
// Emits: none. Slots: none (fills GameFrame's slots).
// Side effects: sends actions through `send`; opens and closes the scoreboard pop-up and the player pop-up.
import { computed, reactive, ref } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import { useGameText } from '../../../src/useGameText.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { createChoiceState, useChoiceReset } from './choiceState.js';
import LogEntries from './LogEntries.vue';
import MarketArea from './MarketArea.vue';
import SeatPopup from './SeatPopup.vue';
import MyArea from './MyArea.vue';
import ScoreBar from './ScoreBar.vue';
import StatusPanel from './StatusPanel.vue';
import { fontSize, px } from './layout.js';
import { useTableView } from './tableView.js';
import { useCardChoice } from './useCardChoice.js';
import { useEnding } from './useEnding.js';
import { useGemTake } from './useGemTake.js';
import { useStatusLines } from './useStatusLines.js';
import { useTokenReturn } from './useTokenReturn.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { text } = useGameText();

// Template ref to the ScoreBar, so the scoreboard pop-up can be opened and closed from here.
const board = ref(null);
// The shared table view, then the half-made choice every composable below reads and writes, then the composables themselves.
// They are wrapped in reactive() so that their refs read as plain values (view.s, shared.picks, card.quote and so on).
const view = reactive(useTableView(() => props.state));
const shared = reactive(createChoiceState());
const take = reactive(useGemTake(view, shared, props.send));
const card = reactive(useCardChoice(view, shared, props.send));
const give = reactive(useTokenReturn(view, shared, props.send));
const ending = reactive(useEnding(view));
const { banner, statusLines } = useStatusLines({ view, ending, shared, take, card });
useChoiceReset(view, shared);
// The composables above say everything in messages (shared/messages.js); the Status box wants the words themselves.
const headline = computed(() => text(banner.value));
const lines = computed(() => statusLines.value.map((line) => ({ tone: line.tone, text: text(line.text) })));
// The final standings with every name in words (an empty seat's name is a message).
const standings = computed(() => ending.standings.map((place) => ({ ...place, name: text(place.name) })));

// Other players' boards: hidden until you click their name in the score bar, one at a time, over the main area (nothing moves).
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => props.state.scoreboard.players,
  hostId: () => props.state.hostSeat,
  isHost: () => ending.isHost,
  remove: (seat, player) => props.send(player.bot ? 'removeBot' : 'kick', { seat }),
});
const openedSeat = computed(() => props.state.seats.find((o) => o && o.seat === openId.value) ?? null); // yours too: your own summary

/**
 * One font size for the whole arena, from the area the frame gives the table (see layout.js).
 *
 * @param {object} area  the frame's slot area
 * @returns {object} an inline style
 * Side effects: none.
 */
const fs = (area) => ({ fontSize: `${fontSize(area)}px` });
</script>

<template>
  <GameFrame class="table-view" :main-span="8">
    <template #scorebar>
      <ScoreBar ref="board" :state="state" :finished="view.finished" :is-host="ending.isHost" v-bind="scoreProps" @again="send('again')" />
    </template>

    <template #main="area">
      <div class="arena" :style="fs(area)">
        <SeatPopup :popup-props="popupProps" :seat="openedSeat" :you="state.you" :turn="state.turn" :finished="view.finished" :gem="px(area, 1.8)" />
        <MarketArea :state="state" :view="view" :card="card" :noble="give" />
        <MyArea :state="state" :view="view" :card="card" :take="take" :give="give" :shared="shared" :board-gem="px(area, 2.2)" :supply-gem="px(area, 2.5)" @pass="send('pass')" />
      </div>
    </template>

    <template #log>
      <LogEntries :entries="state.log" :you="state.you" :name-of="view.nameOf" />
    </template>

    <template #status>
      <StatusPanel
        :state="state"
        :banner="headline"
        :lines="lines"
        :mine="Boolean(view.myTurn || view.pendingMine)"
        :finished="view.finished"
        :is-host="ending.isHost"
        :standings="standings"
        @again="send('again')"
        @show-scores="board.show()"
      />
    </template>
  </GameFrame>
</template>

<style scoped>
/* Everything in the arena is sized in em: the font size is set from the area the frame gives the table (see layout.js),
   so the layout is one fixed shape on the frame's grid. Nothing here depends on how much has happened in the game. */
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  position: relative; /* another player's board opens over the middle of the table */
}
.arena > * {
  min-width: 0;
  min-height: 0;
}
</style>
