<script setup>
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

// Seated players come first (in seat order), then the empty seats up to the chosen seat count.
const seats = computed(() => [
  ...props.state.seats.map((s) => ({
    id: s.seat,
    name: s.name,
    kind: s.bot ? 'bot' : 'human',
    isHost: Boolean(s.host),
    isMe: s.seat === props.state.you,
    away: !s.bot && !s.online,
  })),
  ...Array.from({ length: Math.max(0, props.state.seatCount - props.state.seats.length) }, () => ({ id: null, name: '', kind: 'empty' })),
]);
const targets = computed(() => props.state.limits.targets);
const seatCounts = computed(() => Array.from({ length: props.state.limits.maxSeats - props.state.limits.minSeats + 1 }, (_, i) => props.state.limits.minSeats + i));
const dealing = computed(() => {
  if (props.state.seatCount === 2) return 'Two players: six cards each, two to the crib.';
  if (props.state.seatCount === 3) return 'Three players: five cards each, one card each to the crib, and one more from the deck.';
  if (props.state.seatCount === 4) return 'Four players: five cards each, one card each to the crib.';
  return 'Five players: five cards each, one to the crib, but the dealer is dealt only four and adds nothing.';
});
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <p class="muted">Share this code (click it to copy the invite link). Every seat must be filled (add computer players if you like) before the host starts.</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <SeatLobby
      :seats="seats"
      :is-host="state.isHost"
      @add-bot="send('addBot')"
      @remove-bot="(id) => send('removeBot', { seat: id })"
      @fill-bots="send('fillBots')"
      @kick="(id) => send('kick', { seat: id })"
      @start="send('start')"
    >
      <template #settings>
        <h3>Game</h3>
        <div class="row">
          <span class="muted label">Seats</span>
          <button v-for="n in seatCounts" :key="n" :class="{ primary: state.seatCount === n }" :disabled="!state.isHost || n < state.seats.length" :aria-pressed="state.seatCount === n" @click="send('settings', { seats: n })">{{ n }}</button>
        </div>
        <div class="row">
          <span class="muted label">Play to</span>
          <button v-for="t in targets" :key="t" :class="{ primary: state.target === t }" :disabled="!state.isHost" :aria-pressed="state.target === t" @click="send('settings', { target: t })">{{ t }}</button>
        </div>
        <p class="muted small">{{ dealing }}</p>
      </template>
    </SeatLobby>
  </div>
</template>

<style scoped>
.label {
  min-width: 4.5rem;
}
.small {
  margin: 0;
  font-size: 0.9rem;
}
</style>
