<script setup>
// The Trivium board: the wheel or the question in the middle, the players' names along the bottom, and every player's
// marker somewhere between the two.  Every piece is placed by layout.js from the room the frame gives the table, which
// is what lets a marker travel from a name to the exact spot on the exact button its player tapped.
// Props: state (the server view), view (the reactive game view), reveal (how far the reveal has got), area (the
//   pixels the frame gave us), send (sends an action to the server).
// Emits: none (everything goes through `send`).  Slots: none.
// Side effects: pressing an answer sends it to the server.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import Answers from './Answers.vue';
import Wheel from './Wheel.vue';
import { MARKER, boardLayout, homeOf, spotOf } from './layout.js';

const props = defineProps({
  state: { type: Object, required: true },
  view: { type: Object, required: true },
  reveal: { type: Object, required: true },
  area: { type: Object, required: true },
  send: { type: Function, required: true },
});
const { t } = useGameText();

// Every rectangle of the board, from the room the frame gave us and the question that is up.
const board = computed(() => boardLayout(props.area, props.state.question?.answers.length ?? 0, props.state.players.length));

// The answers in the order they arrived, which is the order the markers travel in.
const order = computed(() => props.state.result?.entries ?? []);

/**
 * Every player's marker: its colour, where it is now, and whether it is still waiting on its name.  A marker moves
 * only once the reveal has reached its answer, and a player who did not answer keeps theirs where it is.
 */
const markers = computed(() =>
  props.state.players.map((player, index) => {
    const home = homeOf(board.value, index);
    const place = order.value.findIndex((entry) => entry.id === player.id);
    const landed = place !== -1 && props.reveal.shown > place ? spotOf(board.value, order.value[place]) : null;
    return { id: player.id, name: player.name, colour: player.colour, at: landed ?? home, waiting: !landed };
  }),
);

// Where the names go: one even slot each, in the order they joined.
const names = computed(() => props.state.players.map((player, index) => ({ ...player, left: index * board.value.slot, width: board.value.slot })));

/**
 * Sends an answer.
 *
 * @param {{ choice: number, x: number, y: number }} pick  the button and where on it the finger landed
 * @returns {void}
 * Side effects: sends `answer` to the server.
 */
const answer = (pick) => props.send('answer', pick);

// The inline style of one marker: its colour, and the middle of it at the point the board worked out.
const markerStyle = (marker) => ({ background: marker.colour, left: `${marker.at.x - MARKER / 2}px`, top: `${marker.at.y - MARKER / 2}px`, width: `${MARKER}px`, height: `${MARKER}px` });
</script>

<template>
  <div class="board" :style="{ width: `${board.width}px`, height: `${board.height}px` }">
    <div class="stage" :style="{ height: `${board.stage.height}px` }">
      <div v-if="view.spinning" class="middle">
        <Wheel :wheel="state.wheel" :spin="state.spin" :left="state.spinLeft" :size="board.wheel.size" />
      </div>
      <Answers
        v-else-if="state.question"
        :question="state.question"
        :board="board"
        :correct="state.correct"
        :lit="reveal.answerShown"
        :mine="state.mine"
        :active="view.canAnswer"
        @pick="answer"
      />
      <div v-else class="middle">
        <p class="over">{{ view.abandoned ? t('table.noQuestions') : t('table.thatIsThat') }}</p>
      </div>
    </div>

    <ul class="names" :style="{ top: `${board.names.y}px`, height: `${board.names.height}px` }">
      <li v-for="person in names" :key="person.id" :style="{ left: `${person.left}px`, width: `${person.width}px` }" :class="{ away: !person.online, acted: person.answered }">
        <span class="who">{{ person.name }}</span>
      </li>
    </ul>

    <div class="markers" aria-hidden="true">
      <span v-for="marker in markers" :key="marker.id" class="marker" :class="{ waiting: marker.waiting }" :style="markerStyle(marker)" />
    </div>
  </div>
</template>

<style scoped>
.board {
  position: relative;
  grid-column: 1 / -1;
  margin: 0 auto;
}
.stage {
  position: absolute;
  inset: 0 0 auto 0;
}
.middle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.over {
  margin: 0;
  font-family: var(--display);
  font-size: 1.6rem;
  color: var(--muted);
}
.names {
  position: absolute;
  left: 0;
  right: 0;
  list-style: none;
  margin: 0;
  padding: 0;
}
.names li {
  position: absolute;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  min-width: 0;
}
.who {
  max-width: 100%;
  padding: 0 0.2rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  color: var(--muted);
}
.names li.acted .who {
  color: var(--parchment);
}
.names li.away {
  opacity: 0.5;
}
.markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.marker {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.45);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  transition:
    left 420ms cubic-bezier(0.3, 0.8, 0.3, 1),
    top 420ms cubic-bezier(0.3, 0.8, 0.3, 1);
}
.marker.waiting {
  opacity: 0.85;
}
@media (prefers-reduced-motion: reduce) {
  .marker {
    transition-duration: 0ms;
  }
}
</style>
