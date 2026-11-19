<script setup>
// The Zurubang waiting room: the invite code, the two seats (the shared SeatLobby), and the host's one setting, the
// score the game is played to.  The game is for exactly two, so there is no table size to choose.
//
// Props:
//   state  {Object}    required.  The player's lobby view: code, seats, you, isHost, target, limits.
//   send   {Function}  required.  send(action, payload) asks the server to do something.
// Emits: none.  Slots: none (it fills SeatLobby's #settings slot).
// Side effects: only through `send`: addBot, removeBot, fillBots, kick, start, and settings.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

/** Both seats in order: whoever is in one, or an empty chair waiting to be filled. */
const seats = computed(() =>
  props.state.seats.map((seat, i) =>
    seat
      ? { id: seat.seat, name: seat.name, kind: seat.bot ? 'bot' : 'human', isHost: Boolean(seat.host), isMe: seat.seat === props.state.you, away: !seat.bot && !seat.online }
      : { id: null, name: '', kind: 'empty', index: i },
  ),
);
const targets = computed(() => props.state.limits.targets);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <p class="muted">{{ t('lobby.share') }}</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <SeatLobby
      :seats="seats"
      :is-host="state.isHost"
      :min="state.limits.min"
      :max="state.limits.max"
      :fill-to="state.limits.fillTo"
      @add-bot="send('addBot')"
      @remove-bot="(slot) => send('removeBot', { slot })"
      @fill-bots="(count) => send('fillBots', { count })"
      @kick="(slot) => send('kick', { slot })"
      @start="send('start')"
    >
      <template #settings>
        <h3>{{ t('lobby.game') }}</h3>
        <div class="row">
          <span class="muted label">{{ t('lobby.playTo') }}</span>
          <button v-for="target in targets" :key="target" :class="{ primary: state.target === target }" :disabled="!state.isHost" :aria-pressed="state.target === target" @click="send('settings', { target })">{{ target }}</button>
        </div>
        <p class="muted small">{{ t('lobby.about') }}</p>
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
