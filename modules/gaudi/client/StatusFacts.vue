<script setup>
// The persistent facts line of the Status box: round, dice left in the bag, first player, the scoring setting and the turn
// order chips. Its elements go straight into the box's facts line (there is no wrapper).
// Props: state (the server's view), windows, finished (Booleans), nameOf (function: seat -> name).
// Emits: none. Side effects: none.
defineProps({
  state: { type: Object, required: true },
  windows: { type: Boolean, default: false },
  finished: { type: Boolean, default: false },
  nameOf: { type: Function, required: true },
});
</script>

<template>
  <strong v-if="!windows">Round {{ state.round }} of {{ state.limits.rounds }}</strong>
  <span v-if="!windows">{{ state.bagCount }} {{ state.bagCount === 1 ? 'die' : 'dice' }} left in the bag</span>
  <span v-if="!windows">First player: {{ nameOf(state.first) }}</span>
  <span v-if="state.settings.badPrivate" class="tag">Bad private scoring</span>
  <ol v-if="!windows && !finished" class="order" aria-label="Turn order this round">
    <li
      v-for="(seat, i) in state.order"
      :key="i"
      :class="{ now: i === state.turnIndex, past: i < state.turnIndex, skipped: i >= state.seats.length && state.seats[seat]?.skipping, me: seat === state.you }"
    >
      {{ nameOf(seat) }}
    </li>
  </ol>
</template>

<style scoped>
.tag {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--muted);
  color: var(--muted);
  white-space: nowrap;
}
.order {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.order li {
  padding: 0 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--bg-sunken);
  font-size: 0.78rem;
}
.order li.past {
  opacity: 0.4;
}
.order li.now {
  border-color: var(--amber);
  background: var(--amber);
  color: var(--amber-ink);
  font-weight: 650;
}
.order li.skipped {
  text-decoration: line-through;
  opacity: 0.35;
}
.order li.me:not(.now) {
  border-color: var(--amber);
}
</style>
