<script setup>
// Props: state {Object, required} the lobby view of the game; send {Function, required} sends a request to the server.
// Emits: none (requests go through `send`: addBot, removeBot, fillBots, kick, colour, settings, start).  Slots: none.
// Side effects: none locally; user actions send requests to the server.
// The waiting room: the invite code, the player list (PlayerListPanel) with marker colours, and the host's game options.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import MarkerPicker from '../../../src/components/MarkerPicker.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';
import { cellColour } from '../grid.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True when this player is the host (only they can change options).
const isHost = computed(() => props.state.hostId === props.state.you);
// The allowed numbers of rounds, from the server's limits.
const rounds = computed(() => props.state.limits.rounds);
// Total turns in the game: everybody is the hinter once a round.
const total = computed(() => props.state.rounds * props.state.players.length);
// True when there are enough players to start.
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
      :size="state.size"
      @size="(n) => send('settings', { size: n })"
      @add-bot="send('addBot')"
      @remove-bot="(slot) => send('removeBot', { slot })"
      @kick="(slot) => send('kick', { slot })"
      @fill-bots="(count) => send('fillBots', { count })"
    >
      <template #lead="{ player }"><span class="chip" :style="{ background: player.colour }" /></template>
      <MarkerPicker :colours="state.colours" :players="state.players" :you="state.you" :can-custom="state.canCustomColour" @pick="(colour) => send('colour', { colour })" />
    </PlayerListPanel>

    <section class="panel stack">
      <h3>{{ t('lobby.length') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.rounds <= rounds.min" :aria-label="t('lobby.fewerRounds')" @click="send('settings', { rounds: state.rounds - 1 })">-</button>
        <strong>{{ t('lobby.rounds', { count: state.rounds }, state.rounds) }}</strong>
        <button :disabled="!isHost || state.rounds >= rounds.max" :aria-label="t('lobby.moreRounds')" @click="send('settings', { rounds: state.rounds + 1 })">+</button>
      </div>
      <p class="muted">{{ t('lobby.turnsInAll', { turns: t('lobby.turnCount', { count: total }, total), players: t('games.players', { count: state.players.length }, state.players.length) }) }}</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ t('lobby.start') }}</button>
        <span v-if="isHost && !canStart" class="muted">{{ t('errors.minPlayers', { min: state.limits.min }) }}</span>
        <span v-if="!isHost" class="muted">{{ t('lobby.waitingForHost') }}</span>
      </div>
    </section>
    <div class="row" aria-hidden="true">
      <span v-for="c in ['A9', 'K9', 'U9', 'AE9', 'AO9']" :key="c" class="strip" :style="{ background: cellColour(c) }" />
    </div>
  </div>
</template>

<style scoped>
.chip {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
.strip {
  flex: 1;
  height: 0.5rem;
  border-radius: 99px;
}
</style>
