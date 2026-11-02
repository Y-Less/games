<script setup>
// The slim bars for the other players, on the frame's own columns: name, colour, role tag, and score.
// Props: players (the other players), psychic (the psychic's id), ended (the game is over), guessing (guessing is in
//   progress), team (a team game, where nobody guesses alone).
// Slots: none.
// Emits: none.
// Side effects: none.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import { barSpan } from './layout.js';

const props = defineProps({
  players: { type: Array, required: true },
  psychic: { type: [Number, String], default: null },
  ended: { type: Boolean, default: false },
  guessing: { type: Boolean, default: false },
  team: { type: Boolean, default: false },
});
const { t } = useGameText();

// Grid placement: how many of the frame's columns each bar spans, given how many bars there are.
const barStyle = computed(() => ({ gridColumn: `span ${barSpan(props.players.length)}` }));
</script>

<template>
  <ul v-if="players.length" class="bars" :aria-label="t('table.players')">
    <li v-for="p in players" :key="p.id" class="bar" :class="{ away: !p.online, psychic: p.id === psychic && !ended }" :style="barStyle">
      <span class="dot" :style="{ background: p.colour }" />
      <strong class="who">{{ p.name }}</strong>
      <span v-if="p.id === psychic && !ended" class="tag psychic-tag">{{ t('table.psychicTag') }}</span>
      <span v-else-if="guessing && !team && p.guessed" class="tag done">{{ t('table.guessedTag') }}</span>
      <span v-if="!p.online" class="tag away">{{ $t('common.away') }}</span>
      <span class="score">{{ p.score }}</span>
    </li>
  </ul>
</template>

<style scoped>
/* The slim bars for the other players, on the frame's own columns. */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr)); /* the frame's own 12 columns and gutter */
  gap: 0.4rem var(--gap, 12px);
}
.bar {
  height: 2.3rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0 0.8rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
}
.bar.psychic {
  border-color: var(--amber);
}
.bar.away {
  opacity: 0.75;
}
.dot {
  display: inline-block;
  vertical-align: middle;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--display);
}
.tag {
  flex: none;
  font-size: 0.72rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.psychic-tag {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
}
.tag.done {
  background: var(--moss);
  border-color: var(--moss);
  color: #10200f;
}
.tag.away {
  color: var(--danger);
  border-color: var(--danger);
}
.score {
  margin-left: auto;
  flex: none;
  font-family: var(--display);
  font-size: 1.3rem;
  line-height: 1;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}
</style>
