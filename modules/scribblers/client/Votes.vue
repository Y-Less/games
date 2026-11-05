<script setup>
// What the table makes of the drawing: a thumbs up or a thumbs down, each of which moves what the drawer scores for
// the turn.  Only somebody who may press one is shown them at all - the table keeps them from the drawer, who has no
// say in their own drawing - so every thumb here is a live one.  They sit in the corner of the board itself, so the
// drawing loses no room to them.
//
// The thumbs are drawn here rather than taken from the player's emoji font (as the toolbox's tools are) because they
// are wanted in the game's own green and rust, and an emoji font paints in its own colours.  One shape does for both:
// a thumbs down is a thumbs up turned half a turn.  There are no counts beside them - how the table voted shows in
// what the drawer scores, not on the board.
//
// Props: votes ({ up, down, you, can }), step (what one thumb is worth, as a share of what the drawer scored).
// Emits: vote ('up' or 'down').  Slots: none.  Side effects: none.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  votes: { type: Object, default: () => ({ up: 0, down: 0, you: null, can: false }) },
  step: { type: Number, default: 0.05 },
});
defineEmits(['vote']);
const { t } = useGameText();

/** The hand, pointing up, in a 24 x 24 box: the cuff below the wrist, and the thumb and the fist above it. */
const CUFF = 'M3 10h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z';
const HAND = 'M9 21V10l1.7-6a2 2 0 0 1 3.9.9V10h4.6a2 2 0 0 1 1.9 2.6l-2.1 7A2 2 0 0 1 17 21z';

// The two thumbs.  The words for each say what pressing it is worth, since the corner of a board has no room for a
// line that explains itself.
const thumbs = computed(() => {
  const percent = Math.round(props.step * 100);
  return [
    { dir: 'up', turn: 'rotate(0 12 12)', label: t('votes.up', { percent }) },
    { dir: 'down', turn: 'rotate(180 12 12)', label: t('votes.down', { percent }) },
  ];
});
// The thumb you have given, if any.
const mine = computed(() => props.votes?.you ?? null);
</script>

<template>
  <div class="votes" :aria-label="t('votes.label')" role="group">
    <button
      v-for="thumb in thumbs"
      :key="thumb.dir"
      type="button"
      class="thumb"
      :class="[thumb.dir, { picked: mine === thumb.dir }]"
      :title="thumb.label"
      :aria-label="thumb.label"
      :aria-pressed="mine === thumb.dir"
      @click="$emit('vote', thumb.dir)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <g :transform="thumb.turn">
          <path :d="CUFF" />
          <path :d="HAND" />
        </g>
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* In the top left corner of the board, over the drawing rather than beside it. */
.votes {
  position: absolute;
  top: 0.4rem;
  left: 0.4rem;
  display: flex;
  gap: 0.1rem;
}
.thumb {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius);
}
.thumb svg {
  display: block;
  width: 1.4rem;
  height: 1.4rem;
}
.thumb path {
  fill: currentColor;
}
.thumb.up {
  color: var(--moss);
}
.thumb.down {
  color: var(--rust);
}
.thumb:hover svg {
  transform: scale(1.15);
}
.thumb.picked {
  outline: 2px solid var(--amber);
  outline-offset: -2px;
}
</style>
