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
    away: Boolean(seat?.away),
  })),
);
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
const seatOptions = computed(() => Array.from({ length: props.state.limits.maxSeats - props.state.limits.minSeats + 1 }, (_, i) => props.state.limits.minSeats + i));
const rounds = computed(() => (props.state.settings.length === 'short' ? 7 : 14));
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
        <h3>Game options</h3>
        <div class="option">
          <span class="muted">Number of seats</span>
          <div class="row">
            <button v-for="n in seatOptions" :key="n" :class="{ primary: state.settings.seats === n }" :disabled="!isHost" :aria-pressed="state.settings.seats === n" @click="send('settings', { seats: n })">{{ n }}</button>
          </div>
        </div>
        <div class="option">
          <span class="muted">Length of the game</span>
          <div class="row">
            <button :class="{ primary: state.settings.length === 'full' }" :disabled="!isHost" :aria-pressed="state.settings.length === 'full'" @click="send('settings', { length: 'full' })">
              Full: 7 down to 1 and back (14 rounds)
            </button>
            <button :class="{ primary: state.settings.length === 'short' }" :disabled="!isHost" :aria-pressed="state.settings.length === 'short'" @click="send('settings', { length: 'short' })">
              7 down to 1 only (7 rounds)
            </button>
          </div>
        </div>
        <label class="check">
          <input type="checkbox" :checked="state.settings.missPoints" :disabled="!isHost" @change="send('settings', { missPoints: $event.target.checked })" />
          <span>Misses score the tricks taken<span class="muted"> (otherwise a miss scores nothing)</span></span>
        </label>
        <label class="check">
          <input type="checkbox" :checked="state.settings.instantWin !== false" :disabled="!isHost" @change="send('settings', { instantWin: $event.target.checked })" />
          <span>Instant win on a 7<span class="muted"> (nominate 7 and win all 7 tricks in the first or last round to win the whole game)</span></span>
        </label>
        <p class="muted">Hit your nomination exactly and score 10 plus the number nominated. {{ rounds }} rounds in all.</p>
      </template>
      <template #footer>
        <button class="quiet" @click="send('leave')">Leave game</button>
      </template>
    </SeatLobby>
  </div>
</template>

<style scoped>
.option {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
}
.check input {
  width: 1.2rem;
  height: 1.2rem;
  margin-top: 0.15rem;
  flex: none;
  accent-color: var(--amber);
}
</style>
