<script setup>
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const isHost = computed(() => props.state.hostSeat === props.state.you);
const seats = computed(() =>
  props.state.seats.map((seat, i) => ({
    id: i,
    name: seat?.name ?? '',
    kind: !seat ? 'empty' : seat.bot ? 'bot' : 'human',
    isHost: i === props.state.hostSeat,
    isMe: i === props.state.you,
    away: Boolean(seat && !seat.bot && !seat.online),
  })),
);
const seatCounts = computed(() => Array.from({ length: props.state.limits.maxSeats - props.state.limits.minSeats + 1 }, (_, i) => props.state.limits.minSeats + i));
const taken = computed(() => props.state.seats.filter(Boolean).length);
const dealing = computed(() => {
  const cards = props.state.decks * 52;
  const each = Math.floor(cards / props.state.seatCount);
  const extra = cards % props.state.seatCount;
  return `${props.state.seatCount} players: ${props.state.decks === 1 ? 'one pack' : 'two packs'}, ${each} cards each${extra ? ` (and ${extra} players get one more)` : ''}.`;
});
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
const change = (settings) => props.send('settings', settings);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <p class="muted">Share this code, or the invite link, with your friends. Empty seats can be filled by computer players.</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <SeatLobby
      :seats="seats"
      :is-host="isHost"
      @add-bot="send('addBot', { seat: firstEmpty() })"
      @remove-bot="(id) => send('removeBot', { seat: id })"
      @fill-bots="send('fillBots')"
      @kick="(id) => send('kick', { seat: id })"
      @start="send('start')"
    >
      <template #settings>
        <h3>Rules for this game</h3>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">Players</legend>
          <div class="row">
            <button v-for="n in seatCounts" :key="n" :class="{ primary: state.seatCount === n }" :disabled="n < taken" :aria-pressed="state.seatCount === n" @click="change({ seats: n })">{{ n }}</button>
          </div>
          <p class="muted deal">{{ dealing }}</p>
        </fieldset>
        <p v-if="!isHost" class="muted">Only the host can change these.</p>
      </template>
    </SeatLobby>
  </div>
</template>

<style scoped>
.group {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.group legend {
  padding: 0;
  margin-bottom: 0.4rem;
}
.deal {
  margin: 0.5rem 0 0;
  font-size: 0.9rem;
}
</style>
