<script setup>
// The waiting room: the invite code, the player list (PlayerListPanel) and the host's game options.
// Props: state (the server's lobby view), send (function: (event, payload) -> Promise<{ ok, error }>). Emits: none. Slots: none.
// Side effects: the buttons send 'settings' and 'start'; the player list sends 'addBot', 'removeBot', 'kick' and 'fillBots'.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// Only the host may change the length of the game and start it.
const isHost = computed(() => props.state.hostId === props.state.you);
// The fewest and most turns each player may be given ({ min, max } from the server).
const turns = computed(() => props.state.limits.turns);
// Turns in the whole game: everyone takes the same number as the guesser.
const total = computed(() => props.state.turnsEach * props.state.players.length);
// There are enough players to start.
const canStart = computed(() => props.state.players.length >= props.state.limits.min);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <h2>{{ t('lobby.title') }}</h2>
      <p class="muted">{{ t('lobby.share') }}</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <PlayerListPanel
      :players="state.players"
      :you="state.you"
      :host-id="state.hostId"
      :is-host="isHost"
      :min="state.limits.min"
      :max="state.limits.max"
      @add-bot="send('addBot')"
      @remove-bot="(id) => send('removeBot', { seat: id })"
      @kick="(id) => send('kick', { userId: id })"
      @fill-bots="(count) => send('fillBots', { count })"
    />

    <section class="panel stack">
      <h3>{{ t('settings.length') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.turnsEach <= turns.min" :aria-label="t('settings.fewerTurns')" @click="send('settings', { turnsEach: state.turnsEach - 1 })">-</button>
        <strong>{{ t('settings.turnsEach', { count: state.turnsEach }, state.turnsEach) }}</strong>
        <button :disabled="!isHost || state.turnsEach >= turns.max" :aria-label="t('settings.moreTurns')" @click="send('settings', { turnsEach: state.turnsEach + 1 })">+</button>
      </div>
      <p class="muted">{{ t('settings.total', { count: total, players: state.players.length }, total) }}</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ t('lobby.start') }}</button>
        <span v-if="isHost && !canStart" class="muted">{{ t('errors.minPlayers', { min: state.limits.min }) }}</span>
        <span v-if="!isHost" class="muted">{{ t('lobby.waitingForHost') }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
</style>
