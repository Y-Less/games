<script setup>
// File: the waiting room of fixed-seat games.  Depends on: Vue only.
// Props: seats (Array of { id, name, kind, isHost?, isMe?, away? }), isHost, starting (Boolean, disables Start), startLabel,
//   allowBots (Boolean), title (String), min / max / fillTo (Number, the game's limits; see below).
// Emits: addBot, removeBot(id), fillBots, kick(id), size(n), start: the parent does the sending.
// Slots: settings (host's game options), footer (extra buttons or notes beside Start).
// Side effects: none itself; only emits events.
// The waiting room for a game with a fixed number of seats, some of which computer players can fill.
// Seats: [{ id, name, kind: 'human' | 'bot' | 'empty', isHost?, isMe?, away? }] in seating order.
// Emits addBot, removeBot(id), fillBots, kick(id), start.  Slot #settings holds the host's game options and
// #footer extra buttons or notes beside Start.
import { computed } from 'vue';
import { useGameText } from '../useGameText.js';
// A seat is named from outside by its slot, which for a game with numbered seats is the seat number (shared/layout.js).
import { slotForSeat } from '../../shared/layout.js';

const props = defineProps({
  seats: { type: Array, required: true },
  isHost: { type: Boolean, default: false },
  starting: { type: Boolean, default: false },
  startLabel: { type: String, default: '' }, // '' : "Start the game"
  allowBots: { type: Boolean, default: true },
  title: { type: String, default: '' }, // '' : "Waiting for players"
  // The game's limits: the fewest it can be played with, the most it allows, and how many "fill with computer players"
  // makes up to.  The table opens as big as the game allows, the host may bring it down to as few as are sitting, and
  // starting settles it at whoever is here.
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  fillTo: { type: Number, required: true },
});
const { t } = useGameText();
const emit = defineEmits(['addBot', 'removeBot', 'fillBots', 'kick', 'size', 'start']);

// Number of seats nobody occupies yet.
const empty = computed(() => props.seats.filter((s) => s.kind === 'empty').length);
// Number of seats held by human players.
const humans = computed(() => props.seats.filter((s) => s.kind === 'human').length);
// Everybody at the table, people and computer players alike.
const seated = computed(() => props.seats.length - empty.value);
// How many the table holds: a seated room is as big as its table, so this is simply how many seats there are.
const cap = computed(() => props.seats.length);
// The table may not be cut below the people already at it, nor below what the game needs.
const capFloor = computed(() => Math.max(props.min, seated.value));
// What enables Start: enough players to play, and at least one of them a person.  Empty seats are no longer in the
// way, because starting settles the table at whoever is here.
const ready = computed(() => seated.value >= props.min && humans.value >= 1);
</script>

<template>
  <section class="lobby panel stack">
    <h2>{{ title || t('lobby.title') }}</h2>
    <div v-if="isHost" class="row cap">
      <button :disabled="cap <= capFloor" :aria-label="t('lobby.fewerPlayers')" @click="emit('size', cap - 1)">-</button>
      <span class="muted">{{ t('lobby.roomFor', { count: cap }, cap) }}</span>
      <button :disabled="cap >= max" :aria-label="t('lobby.morePlayers')" @click="emit('size', cap + 1)">+</button>
    </div>
    <ul class="seats">
      <li v-for="(seat, i) in seats" :key="seat.id ?? `empty-${i}`" class="seat" :class="[seat.kind, { me: seat.isMe, away: seat.away }]">
        <template v-if="seat.kind === 'empty'">
          <span class="muted">{{ t('lobby.emptySeat') }}</span>
          <button v-if="isHost && allowBots" class="quiet" @click="emit('addBot')">{{ t('lobby.addBot') }}</button>
        </template>
        <template v-else>
          <span class="who">
            {{ seat.name }}
            <span v-if="seat.isMe" class="tag">{{ t('common.you') }}</span>
            <span v-if="seat.isHost" class="tag">{{ t('common.host') }}</span>
            <span v-if="seat.kind === 'bot'" class="tag bot">{{ t('common.computer') }}</span>
            <span v-if="seat.away" class="tag away">{{ t('common.away') }}</span>
          </span>
          <button v-if="isHost && seat.kind === 'bot'" class="quiet" @click="emit('removeBot', seat.slot ?? slotForSeat(i))">{{ t('common.remove') }}</button>
          <button v-else-if="isHost && seat.kind === 'human' && !seat.isMe" class="quiet" @click="emit('kick', seat.slot ?? slotForSeat(i))">{{ t('common.remove') }}</button>
        </template>
      </li>
    </ul>

    <div v-if="isHost && allowBots && seated < Math.min(cap, fillTo)" class="row">
      <button @click="emit('fillBots', Math.min(cap, fillTo))">{{ t('lobby.fillUpTo', { count: Math.min(cap, fillTo) }, Math.min(cap, fillTo)) }}</button>
    </div>

    <slot name="settings" />

    <div class="row">
      <button v-if="isHost" class="primary" :disabled="!ready || starting" @click="emit('start')">{{ startLabel || t('lobby.start') }}</button>
      <span v-else class="muted">{{ t('lobby.waitingForHost') }}</span>
      <span v-if="isHost && !ready" class="muted">{{ t('lobby.seatsToFill', { count: min - seated }, min - seated) }}</span>
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
