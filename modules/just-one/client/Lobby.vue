<script setup>
// The waiting room: the invite code, the player list (PlayerListPanel) and the host's game options.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const isHost = computed(() => props.state.hostId === props.state.you);
const turns = computed(() => props.state.limits.turns);
const total = computed(() => props.state.turnsEach * props.state.players.length);
const canStart = computed(() => props.state.players.length >= props.state.limits.min);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <h2>Waiting for players</h2>
      <p class="muted">Share this code, or the invite link, with your friends.</p>
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
      <h3>Length of the game</h3>
      <div class="row">
        <button :disabled="!isHost || state.turnsEach <= turns.min" aria-label="Fewer turns" @click="send('settings', { turnsEach: state.turnsEach - 1 })">-</button>
        <strong>{{ state.turnsEach }} {{ state.turnsEach === 1 ? 'turn' : 'turns' }} each</strong>
        <button :disabled="!isHost || state.turnsEach >= turns.max" aria-label="More turns" @click="send('settings', { turnsEach: state.turnsEach + 1 })">+</button>
      </div>
      <p class="muted">{{ total }} turns in all with {{ state.players.length }} players. Everyone takes turns as the guesser.</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">Start the game</button>
        <span v-if="isHost && !canStart" class="muted">You need at least {{ state.limits.min }} players.</span>
        <span v-if="!isHost" class="muted">Waiting for the host to start.</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
</style>
