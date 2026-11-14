<script setup>
// The waiting room: the invite code, the players with their marker colours, and the host's two settings (how many
// rounds, and how many questions in each).
// Props: state (the server view), send (sends an action to the server).
// Emits: none (everything goes through `send`).  Slots: none.
// Side effects: the buttons send add/remove bot, kick, colour, settings and start requests.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import MarkerPicker from '../../../src/components/MarkerPicker.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True if you are the host (only the host may change the settings).
const isHost = computed(() => props.state.hostId === props.state.you);
// How many questions the whole game will ask.
const total = computed(() => props.state.rounds * props.state.perRound);
// True once there are enough players to start.
const canStart = computed(() => props.state.players.length >= props.state.limits.min);

/**
 * Nudges one of the two settings up or down.
 *
 * @param {'rounds' | 'perRound'} which  the setting
 * @param {number} by  how much to change it by
 * @returns {void}
 * Side effects: sends `settings` to the server.
 */
const nudge = (which, by) => props.send('settings', { [which]: props.state[which] + by });
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <h2>{{ $t('lobby.title') }}</h2>
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
      <h3>{{ $t('lobby.length') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.rounds <= state.limits.rounds.min" :aria-label="t('lobby.fewerRounds')" @click="nudge('rounds', -1)">-</button>
        <strong>{{ t('lobby.rounds', { count: state.rounds }, state.rounds) }}</strong>
        <button :disabled="!isHost || state.rounds >= state.limits.rounds.max" :aria-label="t('lobby.moreRounds')" @click="nudge('rounds', 1)">+</button>
      </div>
      <div class="row">
        <button :disabled="!isHost || state.perRound <= state.limits.perRound.min" :aria-label="t('lobby.fewerQuestions')" @click="nudge('perRound', -1)">-</button>
        <strong>{{ t('lobby.perRound', { count: state.perRound }, state.perRound) }}</strong>
        <button :disabled="!isHost || state.perRound >= state.limits.perRound.max" :aria-label="t('lobby.moreQuestions')" @click="nudge('perRound', 1)">+</button>
      </div>
      <p class="muted">{{ t('lobby.totalQuestions', { count: total }, total) }}</p>
      <p v-if="!isHost" class="muted">{{ t('lobby.hostChooses') }}</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ $t('lobby.start') }}</button>
        <span v-if="isHost && !canStart" class="muted">{{ t('errors.minPlayers', { min: state.limits.min }) }}</span>
        <span v-if="!isHost" class="muted">{{ $t('lobby.waitingForHost') }}</span>
      </div>
    </section>
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
</style>
