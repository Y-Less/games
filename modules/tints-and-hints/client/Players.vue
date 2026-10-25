<script setup>
defineProps({
  players: { type: Array, required: true },
  you: { type: Number, required: true },
  hinter: { type: Number, default: null },
  hostId: { type: Number, default: null },
  showGuessed: { type: Boolean, default: false },
});
defineEmits(['kick']);
</script>

<template>
  <ul class="scores">
    <li v-for="p in players" :key="p.id" class="row" :class="{ away: !p.online }">
      <span class="chip" :style="{ background: p.colour }" />
      <span class="name">{{ p.name }}<span v-if="p.id === you" class="muted"> (you)</span></span>
      <span v-if="p.id === hinter" class="tag">hinter</span>
      <span v-else-if="showGuessed && p.guessed" class="tag done">guessed</span>
      <span v-if="!p.online" class="muted">away</span>
      <button v-if="!p.online && you === hostId && p.id !== you" class="quiet" @click="$emit('kick', p.id)">Remove</button>
    </li>
  </ul>
</template>

<style scoped>
.scores {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.away {
  opacity: 0.7;
}
.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.chip {
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
.tag {
  font-size: 0.8rem;
  padding: 0.05rem 0.5rem;
  border-radius: 99px;
  background: var(--amber);
  color: var(--amber-ink);
}
.tag.done {
  background: var(--moss);
}
</style>
