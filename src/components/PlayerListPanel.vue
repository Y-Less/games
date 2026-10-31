<script setup>
// The "Players (n of max)" panel of a waiting room whose players are not tied to numbered seats: each player with their
// tags, the host's Remove buttons, and the host's Add / Fill with computer players buttons. A game's own per-player
// extras go in the #lead slot (shown before the name, e.g. a colour chip; it gets the `player`).
// Players: [{ id, name, bot?, online? }]. Emits addBot, removeBot(id), kick(id), fillBots(count): the lobby does the sending.
import BotIcon from './BotIcon.vue';

defineProps({
  players: { type: Array, required: true },
  you: { type: [Number, String], default: null },
  hostId: { type: [Number, String], default: null },
  isHost: { type: Boolean, default: false },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
});
const emit = defineEmits(['addBot', 'removeBot', 'kick', 'fillBots']);
</script>

<template>
  <section class="panel stack">
    <h3>Players ({{ players.length }} of {{ max }})</h3>
    <ul class="players">
      <li v-for="p in players" :key="p.id" class="row">
        <slot name="lead" :player="p" />
        <span class="name">{{ p.name }}<span v-if="p.id === you" class="muted"> (you)</span></span>
        <span v-if="p.bot" class="muted bot-tag"><BotIcon :size="16" /> computer</span>
        <span v-if="p.id === hostId" class="muted">host</span>
        <span v-if="!p.online" class="muted">away</span>
        <button v-if="isHost && p.bot" class="quiet" @click="emit('removeBot', p.id)">Remove</button>
        <button v-else-if="isHost && p.id !== you" class="quiet" @click="emit('kick', p.id)">Remove</button>
      </li>
    </ul>
    <div v-if="isHost" class="row bots">
      <button :disabled="players.length >= max" @click="emit('addBot')">Add a computer player</button>
      <button v-if="players.length < min" @click="emit('fillBots', min)">Fill up to {{ min }} players with computer players</button>
      <span v-if="players.length >= max" class="muted">The table is full ({{ max }} players).</span>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.bots {
  flex-wrap: wrap;
}
.bot-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.players {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
