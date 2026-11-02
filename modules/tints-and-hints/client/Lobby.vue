<script setup>
// Props: state {Object, required} the lobby view of the game; send {Function, required} sends a request to the server.
// Emits: none (requests go through `send`: addBot, removeBot, fillBots, kick, colour, settings, start). Slots: none.
// Side effects: none locally; user actions send requests to the server.
// The waiting room: the invite code, the player list (PlayerListPanel) with marker colours, and the host's game options.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';
import { cellColour } from '../grid.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True when this player is the host (only they can change options).
const isHost = computed(() => props.state.hostId === props.state.you);
// Set of marker colours already chosen, so those cannot be picked again.
const taken = computed(() => new Set(props.state.players.map((p) => p.colour)));
// This player's own entry in the player list.
const mine = computed(() => props.state.players.find((p) => p.id === props.state.you));
// The allowed numbers of turns each, from the server's limits.
const turns = computed(() => props.state.limits.turns);
// Total turns in the game: turns each times the number of players.
const total = computed(() => props.state.turnsEach * props.state.players.length);
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
          <span v-if="mine && !state.colours.includes(mine.colour)" class="swatch-pick chosen" :style="{ background: mine.colour }" :title="t('profile.yourOwnColour')" />
          <label v-if="state.canCustomColour" class="custom muted">
            {{ t('profile.anyColour') }}
            <input type="color" class="picker" :value="mine?.colour" :aria-label="t('lobby.chooseAnyColour')" @change="send('colour', { colour: $event.target.value })" />
          </label>
        </div>
        <span v-if="!state.canCustomColour" class="muted">{{ t('lobby.unlockColour') }}</span>
      </div>
    </PlayerListPanel>

    <section class="panel stack">
      <h3>{{ t('lobby.length') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.turnsEach <= turns.min" :aria-label="t('lobby.fewerTurns')" @click="send('settings', { turnsEach: state.turnsEach - 1 })">-</button>
        <strong>{{ t('lobby.turnsEach', { count: state.turnsEach }, state.turnsEach) }}</strong>
        <button :disabled="!isHost || state.turnsEach >= turns.max" :aria-label="t('lobby.moreTurns')" @click="send('settings', { turnsEach: state.turnsEach + 1 })">+</button>
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
.strip {
  flex: 1;
  height: 0.5rem;
  border-radius: 99px;
}
</style>
