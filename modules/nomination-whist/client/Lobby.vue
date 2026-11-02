<script setup>
// Nomination Whist lobby: invite code, seat list (via SeatLobby) and the host's game options.
// Props: state {Object, required} the lobby view of the game; send {Function, required} sends a request to the server.
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
    away: Boolean(seat?.away),
  })),
);
// Returns the index of the first empty seat (-1 if full), where a computer player is added.
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
// The selectable seat counts, from the server's minimum to its maximum inclusive.
const seatOptions = computed(() => Array.from({ length: props.state.limits.maxSeats - props.state.limits.minSeats + 1 }, (_, i) => props.state.limits.minSeats + i));
// Number of rounds in the chosen game length (a short game is 7 rounds, a full one 14).
const rounds = computed(() => (props.state.settings.length === 'short' ? 7 : 14));
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
        <h3>{{ t('lobby.options') }}</h3>
        <div class="option">
          <span class="muted">{{ t('lobby.seats') }}</span>
          <div class="row">
            <button v-for="n in seatOptions" :key="n" :class="{ primary: state.settings.seats === n }" :disabled="!isHost" :aria-pressed="state.settings.seats === n" @click="send('settings', { seats: n })">{{ n }}</button>
          </div>
        </div>
        <div class="option">
          <span class="muted">{{ t('lobby.length') }}</span>
          <div class="row">
            <button :class="{ primary: state.settings.length === 'full' }" :disabled="!isHost" :aria-pressed="state.settings.length === 'full'" @click="send('settings', { length: 'full' })">
              {{ t('lobby.full') }}
            </button>
            <button :class="{ primary: state.settings.length === 'short' }" :disabled="!isHost" :aria-pressed="state.settings.length === 'short'" @click="send('settings', { length: 'short' })">
              {{ t('lobby.short') }}
            </button>
          </div>
        </div>
        <label class="check">
          <input type="checkbox" :checked="state.settings.missPoints" :disabled="!isHost" @change="send('settings', { missPoints: $event.target.checked })" />
          <span>{{ t('lobby.missPoints') }}<span class="muted"> {{ t('lobby.missPointsNote') }}</span></span>
        </label>
        <label class="check">
          <input type="checkbox" :checked="state.settings.instantWin !== false" :disabled="!isHost" @change="send('settings', { instantWin: $event.target.checked })" />
          <span>{{ t('lobby.instantWin') }}<span class="muted"> {{ t('lobby.instantWinNote') }}</span></span>
        </label>
        <label class="check">
          <input type="checkbox" :checked="state.settings.jokers === true" :disabled="!isHost" @change="send('settings', { jokers: $event.target.checked })" />
          <span>{{ t('lobby.jokers') }}<span class="muted"> {{ t('lobby.jokersNote') }}</span></span>
        </label>
        <label class="check">
          <input type="checkbox" :checked="state.settings.hints !== false" :disabled="!isHost" @change="send('settings', { hints: $event.target.checked })" />
          <span>{{ t('lobby.hints') }}<span class="muted"> {{ t('lobby.hintsNote') }}</span></span>
        </label>
        <p class="muted">{{ t('lobby.scoring', { rounds }) }}</p>
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
