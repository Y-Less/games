<script setup>
// The waiting room: the invite code, the player list (PlayerListPanel), and the host's game options.
// Props: state (the server's lobby view), send (function: (event, payload) -> Promise<{ ok, error }>).  Emits: none.  Slots: none.
// Side effects: the buttons send 'settings' and 'start'; the player list sends 'addBot', 'removeBot', 'kick' and 'fillBots'.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// Only the host may change the game's options and start it.
const isHost = computed(() => props.state.hostId === props.state.you);
// There are enough players to start.
const canStart = computed(() => props.state.players.length >= props.state.limits.min);
// How many turns the game will take: everybody draws once a round.
const turns = computed(() => props.state.settings.rounds * props.state.players.length);

/**
 * The three options the host may change, each with its bounds and the step the buttons move it by.
 * `key` is both the setting's name and the part of its words' keys, so a setting is named once.
 */
const options = computed(() => [
  { key: 'rounds', value: props.state.settings.rounds, bounds: props.state.limits.rounds, step: 1 },
  { key: 'drawTime', value: props.state.settings.drawTime, bounds: props.state.limits.drawTime, step: 10 },
  { key: 'wordChoices', value: props.state.settings.wordChoices, bounds: props.state.limits.wordChoices, step: 1 },
]);

/**
 * Asks the server to change one option, keeping it inside its bounds.
 * @param {object} option  one entry of `options`
 * @param {number} by  how much to change it by
 * @returns {Promise<object>} the server's reply
 * Side effects: sends a 'settings' request.
 */
const change = (option, by) => props.send('settings', { [option.key]: Math.min(option.bounds.max, Math.max(option.bounds.min, option.value + by)) });
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
      <h3>{{ t('settings.title') }}</h3>
      <div v-for="option in options" :key="option.key" class="row option">
        <span class="label">{{ t(`settings.${option.key}`) }}</span>
        <button :disabled="!isHost || option.value <= option.bounds.min" :aria-label="t(`settings.less.${option.key}`)" @click="change(option, -option.step)">-</button>
        <strong class="value">{{ t(`settings.value.${option.key}`, { n: option.value }, option.value) }}</strong>
        <button :disabled="!isHost || option.value >= option.bounds.max" :aria-label="t(`settings.more.${option.key}`)" @click="change(option, option.step)">+</button>
      </div>
      <p class="muted">{{ t('settings.total', { count: turns, players: state.players.length }, turns) }}</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ t('lobby.start') }}</button>
        <span v-if="isHost && !canStart" class="muted">{{ t('errors.minPlayers', { min: state.limits.min }) }}</span>
        <span v-if="!isHost" class="muted">{{ t('lobby.waitingForHost') }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.option {
  align-items: center;
  gap: 0.5rem;
}
.label {
  flex: 1;
  min-width: 8rem;
}
.value {
  min-width: 7rem;
  text-align: center;
}
</style>
