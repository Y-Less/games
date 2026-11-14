<script setup>
// The waiting room: the invite code, the player list (PlayerListPanel) with marker colours, and the host's game options.
// Props: state (the server view: code, players, you, hostId, mode, rounds, limits), send (sends an action to the server).
// Emits: none (everything goes through `send`).
// Slots: none (it fills PlayerListPanel's `lead` slot with each player's colour chip).
// Side effects: the template's buttons send add/remove bot, kick, colour, mode, settings, and start requests.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import MarkerPicker from '../../../src/components/MarkerPicker.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True if you are the host (only the host may change the options).
const isHost = computed(() => props.state.hostId === props.state.you);
// The allowed range for the number of rounds ({ min, max }).
const rounds = computed(() => props.state.limits.rounds);
// How many turns the whole game will last: everybody is the psychic once a round.
const total = computed(() => props.state.rounds * props.state.players.length);
// True once there are enough players to start.
const canStart = computed(() => props.state.players.length >= props.state.limits.min);
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
      <h3>{{ t('lobby.howYouPlay') }}</h3>
      <div class="row modes" role="radiogroup" :aria-label="t('lobby.mode')">
        <label class="mode" :class="{ chosen: state.mode !== 'team' }">
          <input type="radio" name="mode" value="solo" :checked="state.mode !== 'team'" :disabled="!isHost" @change="send('mode', { mode: 'solo' })" />
          <strong>{{ t('lobby.solo') }}</strong>
          <span class="muted">{{ t('lobby.soloText') }}</span>
        </label>
        <label class="mode" :class="{ chosen: state.mode === 'team' }">
          <input type="radio" name="mode" value="team" :checked="state.mode === 'team'" :disabled="!isHost" @change="send('mode', { mode: 'team' })" />
          <strong>{{ t('lobby.team') }}</strong>
          <span class="muted">{{ t('lobby.teamText') }}</span>
        </label>
      </div>
      <p v-if="!isHost" class="muted">{{ t('lobby.hostChooses') }}</p>
      <h3>{{ t('lobby.length') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.rounds <= rounds.min" :aria-label="t('lobby.fewerRounds')" @click="send('settings', { rounds: state.rounds - 1 })">-</button>
        <strong>{{ t('lobby.rounds', { count: state.rounds }, state.rounds) }}</strong>
        <button :disabled="!isHost || state.rounds >= rounds.max" :aria-label="t('lobby.moreRounds')" @click="send('settings', { rounds: state.rounds + 1 })">+</button>
      </div>
      <p class="muted">{{ t('lobby.totalTurns', { turns: total, players: state.players.length }) }}</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ $t('lobby.start') }}</button>
        <span v-if="isHost && !canStart" class="muted">{{ t('errors.minPlayers', { min: state.limits.min }) }}</span>
        <span v-if="!isHost" class="muted">{{ $t('lobby.waitingForHost') }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.modes {
  flex-wrap: wrap;
  align-items: stretch;
}
.mode {
  flex: 1 1 14rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.8rem;
  border: 2px solid var(--line);
  border-radius: 12px;
  cursor: pointer;
}
.mode.chosen {
  border-color: var(--amber);
}
.mode input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.chip {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
</style>
