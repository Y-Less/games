<script setup>
// Splendour lobby: invite code, seat list (via SeatLobby), and the host's game options.
// Props: state (the lobby view of the game), send (sends a request to the server).
// Emits: none (all actions go through `send`: addBot, removeBot, fillBots, kick, start, settings).
// Slots: none (fills SeatLobby's `settings` slot).
// Side effects: none locally; user actions send requests to the server.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True when this player is the host (only they can change options).
const isHost = computed(() => props.state.hostSeat === props.state.you);
// Seats mapped to the shape SeatLobby expects (id, name, kind, host/me/away flags); empty seats are null in the state.
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
// The usual target: its button says so.
const USUAL_TARGET = 15;
// Returns the index of the first empty seat (-1 if full), where a computer player is added.
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
// How many seats are taken, by people or computer players.
const occupied = computed(() => props.state.seats.filter(Boolean).length);
// Sends a settings change to the server; `settings` is an object of the options to change.
const change = (settings) => props.send('settings', settings);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <p class="muted">{{ t('lobby.share') }}</p>
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
        <h3>{{ t('lobby.rules') }}</h3>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">{{ t('lobby.players') }}</legend>
          <div class="row">
            <button
              v-for="n in state.limits.seatCounts"
              :key="n"
              :class="{ primary: state.settings.seats === n }"
              :aria-pressed="state.settings.seats === n"
              :disabled="occupied > n"
              @click="change({ seats: n })"
            >
              {{ t('lobby.playerCount', { count: n }, n) }}
            </button>
          </div>
        </fieldset>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">{{ t('lobby.playTo') }}</legend>
          <div class="row">
            <button v-for="target in state.limits.targets" :key="target" :class="{ primary: state.settings.target === target }" :aria-pressed="state.settings.target === target" @click="change({ target })">
              {{ target === USUAL_TARGET ? t('lobby.targetUsual', { n: target }) : target }}
            </button>
          </div>
        </fieldset>
        <p v-if="!isHost" class="muted">{{ t('lobby.hostOnly') }}</p>
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
</style>
