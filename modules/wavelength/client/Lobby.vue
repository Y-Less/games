<script setup>
// The waiting room: the invite code, the player list (PlayerListPanel) with marker colours, and the host's game options.
// Props: state (the server view: code, players, you, hostId, mode, turnsEach, limits), send (sends an action to the server).
// Emits: none (everything goes through `send`).
// Slots: none (it fills PlayerListPanel's `lead` slot with each player's colour chip).
// Side effects: the template's buttons send add/remove bot, kick, colour, mode, settings, and start requests.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True if you are the host (only the host may change the options).
const isHost = computed(() => props.state.hostId === props.state.you);
// The marker colours already chosen, so the picker can show them as unavailable.
const taken = computed(() => new Set(props.state.players.map((p) => p.colour)));
// Your own player record.
const mine = computed(() => props.state.players.find((p) => p.id === props.state.you));
// The allowed range for turns per player ({ min, max }).
const turns = computed(() => props.state.limits.turns);
// How many turns the whole game will last (turns each times players).
const total = computed(() => props.state.turnsEach * props.state.players.length);
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
      @add-bot="send('addBot')"
      @remove-bot="(id) => send('removeBot', { seat: id })"
      @kick="(id) => send('kick', { userId: id })"
      @fill-bots="(count) => send('fillBots', { count })"
    >
      <template #lead="{ player }"><span class="chip" :style="{ background: player.colour }" /></template>
      <div class="stack">
        <span class="muted">{{ t('lobby.yourColour') }}</span>
        <div class="row">
          <button
            v-for="c in state.colours"
            :key="c"
            class="swatch-pick"
            :class="{ chosen: mine?.colour === c }"
            :style="{ background: c }"
            :disabled="taken.has(c) && mine?.colour !== c"
            :aria-label="t('lobby.chooseColour', { colour: c })"
            @click="send('colour', { colour: c })"
          />
          <span v-if="mine && !state.colours.includes(mine.colour)" class="swatch-pick chosen" :style="{ background: mine.colour }" :title="t('lobby.ownColour')" />
          <label v-if="state.canCustomColour" class="custom muted">
            {{ t('lobby.anyColour') }}
            <input type="color" class="picker" :value="mine?.colour" :aria-label="t('lobby.chooseAnyColour')" @change="send('colour', { colour: $event.target.value })" />
          </label>
        </div>
        <span v-if="!state.canCustomColour" class="muted">{{ t('lobby.unlockColours') }}</span>
      </div>
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
        <button :disabled="!isHost || state.turnsEach <= turns.min" :aria-label="t('lobby.fewerTurns')" @click="send('settings', { turnsEach: state.turnsEach - 1 })">-</button>
        <strong>{{ t('lobby.turnsEach', { count: state.turnsEach }, state.turnsEach) }}</strong>
        <button :disabled="!isHost || state.turnsEach >= turns.max" :aria-label="t('lobby.moreTurns')" @click="send('settings', { turnsEach: state.turnsEach + 1 })">+</button>
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
.swatch-pick {
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--line);
}
.custom {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.picker {
  width: 2.8rem;
  height: 2.4rem;
  padding: 0.1rem;
}
.swatch-pick.chosen {
  outline: 3px solid var(--amber);
  outline-offset: 2px;
}
</style>
