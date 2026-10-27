<script setup>
// The standard scoreboard for every game:
//   - a bar with everyone's current score, always visible (it sticks under the site header while the page scrolls);
//   - a large pop-up with every round so far, which opens by itself after each round (unless `roundPopups` is false, for
//     games whose rounds mean little) and again at the end,
//     and any time from the "All rounds" button.
// Give it the standard shape from shared/scores.js. Slots: #round (extra detail about the round that has just
// finished, shown above the table in the pop-up) and #footer (replaces the default Continue button).
// Closing the pop-up that a round ending opened (its Continue button, Close, Esc or a click outside) emits `continue`:
// that is how a person says they are ready for the next round, so games need no separate button for it. Pass
// `waiting` (the names of people still to close it) to show "Waiting for ..." in the footer, `awaiting` (true while
// this person still has to close it) to bring it back if they reload or it was missed, and a boolean `ready` on a
// player to show a tick on their chip once they have.
// A player with `current: true` (whose turn it is, or who is leading the round) gets a bright glowing chip, with
// aria-current, drawn without changing the chip's size. A player with `bot: true` gets a small computer icon (BotIcon) on their chip. Games that can show more about each
// player (their own board, say) pass `hasDetails`, a function (playerId) => boolean: those chips become buttons that
// emit `details` with the player's id on a click, or with null when that player's details (`openDetails`) are already open,
// and `hover` (with the id) and `unhover` as the pointer enters and leaves the chip (usePlayerPopup turns these into the pop-up).
import { computed, ref, watch } from 'vue';
import { placements } from '../../shared/scores.js';
import BotIcon from './BotIcon.vue';
import GameModal from './GameModal.vue';
import ScoreTable from './ScoreTable.vue';

const props = defineProps({
  players: { type: Array, required: true }, // [{ id, name, score, isMe?, away?, note? }]
  rounds: { type: Array, default: () => [] },
  lowIsBetter: { type: Boolean, default: false },
  target: { type: Number, default: null },
  finished: { type: Boolean, default: false },
  autoOpen: { type: Boolean, default: true }, // open the pop-up when a round finishes (and at the end)
  roundPopups: { type: Boolean, default: true }, // false: no pop-up between rounds, only the final one (and the button)
  running: { type: Boolean, default: false },
  sticky: { type: Boolean, default: true },
  waiting: { type: Array, default: () => [] }, // names of the people who have not yet closed the round pop-up
  awaiting: { type: Boolean, default: false }, // this person still has to close the round pop-up
  hasDetails: { type: Function, default: null }, // (playerId) => boolean: this player's chip opens their details
  openDetails: { type: [String, Number], default: null }, // the player whose details are open now, if any
});
const emit = defineEmits(['closed', 'continue', 'details', 'hover', 'unhover']);

const clickable = (p) => Boolean(props.hasDetails?.(p.id));
const isOpen = (p) => props.openDetails !== null && props.openDetails === p.id;
function toggleDetails(p, event) {
  emit('details', isOpen(p) ? null : p.id, event?.currentTarget);
}

const open = ref(false);
const justFinished = ref(false); // the pop-up was opened by a round ending (rather than by the button)

const places = computed(() => placements(Object.fromEntries(props.players.map((p) => [p.id, p.score])), { lowIsBetter: props.lowIsBetter }));
const winners = computed(() => props.players.filter((p) => places.value[p.id] === 1));
const lastRound = computed(() => props.rounds.at(-1) ?? null);
const title = computed(() => {
  if (props.finished) return 'Final scores';
  if (justFinished.value && lastRound.value) return `Scores after ${lastRound.value.label}`;
  return 'Scores so far';
});

// Someone who still has to close the round pop-up (they reloaded, or it opened before they joined) gets it again;
// once the game moves on without them, it goes.
watch(
  () => props.awaiting && !props.finished,
  (needed) => {
    if (needed && !open.value && props.rounds.length && props.roundPopups) {
      justFinished.value = true;
      open.value = true;
    } else if (!needed && open.value && justFinished.value && !props.finished) {
      justFinished.value = false;
      open.value = false;
    }
  },
  { immediate: true },
);

// A new round arriving while the page is open (not the history that arrives when you reconnect) opens the pop-up.
let seen = props.rounds.length;
watch(
  () => props.rounds.length,
  (count) => {
    if (count > seen && props.autoOpen && props.roundPopups) {
      justFinished.value = true;
      open.value = true;
    }
    seen = count;
  },
);
watch(
  () => props.finished,
  (done, was) => {
    if (done && !was && props.autoOpen) {
      justFinished.value = true;
      open.value = true;
    }
  },
);

function show() {
  justFinished.value = false;
  open.value = true;
}
function close() {
  open.value = false;
  closed();
}
function proceed() {
  close();
}
function closed() {
  if (justFinished.value && !props.finished) emit('continue'); // closing the round's pop-up means "ready for the next round"
  justFinished.value = false;
  emit('closed');
}
defineExpose({ show, close });
</script>

<template>
  <section class="score-bar" :class="{ sticky }" aria-label="Scores">
    <ul class="chips">
      <li v-for="p in players" :key="p.id" class="chip" :aria-current="p.current ? 'true' : undefined" :class="{ current: p.current, open: isOpen(p), me: p.isMe, lead: places[p.id] === 1 && players.some((q) => q.score !== p.score), away: p.away }">
        <component
          :is="clickable(p) ? 'button' : 'span'"
          class="chip-body"
          :class="{ 'chip-button': clickable(p) }"
          :type="clickable(p) ? 'button' : undefined"
          :aria-label="clickable(p) ? `Show ${p.name}'s details` : undefined"
          :title="clickable(p) ? 'Show details' : undefined"
          :aria-pressed="clickable(p) ? isOpen(p) : undefined"
          @click="clickable(p) && toggleDetails(p, $event)"
          @pointerenter="clickable(p) && emit('hover', p.id, $event.currentTarget)"
          @pointerleave="clickable(p) && emit('unhover')"
        >
          <span v-if="p.bot" class="bot"><BotIcon /></span>
          <span class="name">{{ p.name }}<span v-if="p.isMe" class="you"> (you)</span></span>
          <strong class="points">{{ p.score }}</strong>
          <span v-if="p.ready !== undefined" class="tick" :class="{ unready: !p.ready }" :title="p.ready ? 'Ready for the next round' : undefined" :aria-label="p.ready ? 'ready' : undefined" :aria-hidden="p.ready ? undefined : 'true'">&#10003;</span>
          <small v-if="p.note" class="muted">{{ p.note }}</small>
        </component>
      </li>
    </ul>
    <button class="quiet all" @click="show">All rounds</button>
  </section>

  <GameModal v-model:open="open" :title="title" size="lg" @close="closed">
    <p v-if="finished && winners.length" class="winner" role="status">
      <template v-if="winners.length === 1">{{ winners[0].name }}{{ winners[0].isMe ? ' (you)' : '' }} wins!</template>
      <template v-else>A tie: {{ winners.map((w) => w.name).join(' and ') }} win.</template>
    </p>
    <slot name="round" />
    <ScoreTable :players="players" :rounds="rounds" :low-is-better="lowIsBetter" :target="target" :running="running" />
    <template #footer>
      <slot name="footer">
        <span v-if="waiting.length && !finished" class="waiting muted" role="status">Waiting for {{ waiting.join(', ') }}&hellip;</span>
        <button class="primary" data-autofocus @click="proceed">{{ finished ? 'Close' : 'Continue' }}</button>
      </slot>
    </template>
  </GameModal>
</template>

<style scoped>
.score-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.6rem;
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.score-bar.sticky {
  position: sticky;
  top: calc(var(--hub-bar-height, 3.4rem) / var(--fit-zoom, 1)); /* the game may be scaled down to fit the window */
  z-index: 10;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
}
.chip {
  display: flex;
  padding: 0;
  border-radius: 999px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
.chip-body {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  min-width: 0;
}
button.chip-button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}
button.chip-button:hover,
button.chip-button:focus-visible {
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}
button.chip-button:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 1px;
}
.chip.current {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 22%, var(--bg-sunken));
  box-shadow: 0 0 0 2px var(--amber), 0 0 14px 3px color-mix(in srgb, var(--amber) 70%, transparent); /* outside the box: no change of size */
}
.chip.current .name {
  font-weight: 650;
}
.chip.open {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 14%, var(--bg-sunken));
}
.bot {
  display: inline-flex;
  align-self: center;
  color: var(--muted);
  font-size: 1rem;
}
.chip.me {
  border-color: var(--amber);
}
.chip.lead .points {
  color: var(--amber);
}
.chip.lead .name::before {
  content: '★ ';
  color: var(--amber);
}
.chip.away {
  opacity: 0.6;
}
.name {
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.you {
  color: var(--amber);
}
.points {
  min-width: 2ch;
  text-align: right;
  font-family: var(--display);
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.chip small {
  font-size: 0.72rem;
}
.tick.unready {
  visibility: hidden; /* the tick's room is kept, so a chip does not widen when its player is ready */
}
.tick {
  color: var(--moss, #7fb069);
  font-weight: 700;
}
.waiting {
  margin-right: auto;
}
.winner {
  margin: 0 0 0.6rem;
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
  text-align: center;
}
@media (max-width: 480px) {
  .chip-body {
    padding: 0.15rem 0.5rem;
    gap: 0.3rem;
  }
  .name {
    max-width: 5.5rem;
    font-size: 0.85rem;
  }
  .points {
    font-size: 1rem;
  }
}
</style>
