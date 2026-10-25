<script setup>
// The waiting room for a game with a fixed number of seats, some of which computer players can fill.
// Seats: [{ id, name, kind: 'human' | 'bot' | 'empty', isHost?, isMe?, away? }] in seating order.
// Emits addBot, removeBot(id), fillBots, kick(id), start. Slot #settings holds the host's game options and
// #footer extra buttons or notes beside Start.
import { computed } from 'vue';

const props = defineProps({
  seats: { type: Array, required: true },
  isHost: { type: Boolean, default: false },
  starting: { type: Boolean, default: false },
  startLabel: { type: String, default: 'Start the game' },
  allowBots: { type: Boolean, default: true },
  title: { type: String, default: 'Waiting for players' },
});
const emit = defineEmits(['addBot', 'removeBot', 'fillBots', 'kick', 'start']);

const empty = computed(() => props.seats.filter((s) => s.kind === 'empty').length);
const humans = computed(() => props.seats.filter((s) => s.kind === 'human').length);
const ready = computed(() => empty.value === 0 && humans.value >= 1);
</script>

<template>
  <section class="lobby panel stack">
    <h2>{{ title }}</h2>
    <ul class="seats">
      <li v-for="(seat, i) in seats" :key="seat.id ?? `empty-${i}`" class="seat" :class="[seat.kind, { me: seat.isMe, away: seat.away }]">
        <template v-if="seat.kind === 'empty'">
          <span class="muted">Empty seat</span>
          <button v-if="isHost && allowBots" class="quiet" @click="emit('addBot')">Add a computer player</button>
        </template>
        <template v-else>
          <span class="who">
            {{ seat.name }}
            <span v-if="seat.isMe" class="tag">you</span>
            <span v-if="seat.isHost" class="tag">host</span>
            <span v-if="seat.kind === 'bot'" class="tag bot">computer</span>
            <span v-if="seat.away" class="tag away">away</span>
          </span>
          <button v-if="isHost && seat.kind === 'bot'" class="quiet" @click="emit('removeBot', seat.id)">Remove</button>
          <button v-else-if="isHost && seat.kind === 'human' && !seat.isMe" class="quiet" @click="emit('kick', seat.id)">Remove</button>
        </template>
      </li>
    </ul>

    <div v-if="isHost && allowBots && empty > 1" class="row">
      <button @click="emit('fillBots')">Fill the empty seats with computer players</button>
    </div>

    <slot name="settings" />

    <div class="row">
      <button v-if="isHost" class="primary" :disabled="!ready || starting" @click="emit('start')">{{ startLabel }}</button>
      <span v-else class="muted">Waiting for the host to start.</span>
      <span v-if="isHost && empty" class="muted">{{ empty }} more {{ empty === 1 ? 'seat' : 'seats' }} to fill.</span>
      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.seats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.seat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  border-radius: 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
.seat.empty {
  border-style: dashed;
}
.seat.me {
  border-color: var(--amber);
}
.seat.away {
  opacity: 0.65;
}
.who {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tag {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--amber);
  color: var(--amber);
}
.tag.bot {
  border-color: var(--muted);
  color: var(--muted);
}
.tag.away {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
