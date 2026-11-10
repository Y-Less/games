<script setup>
// The waiting room: the invite code, the shared players panel, and the host's three settings.  The length of the game
// comes out of the table itself - every pair of players draws - so the lobby says what that works out as.
// Props: state (the server's lobby view), send (function: (event, payload) -> Promise<{ ok, error }>).
// Emits: none.  Slots: none.
// Side effects: the buttons send 'settings' and 'start'; the player list sends 'addBot', 'removeBot', 'kick' and 'fillBots'.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

const isHost = computed(() => props.state.hostId === props.state.you);
const limits = computed(() => props.state.limits);
const settings = computed(() => props.state.settings);
const canStart = computed(() => props.state.players.length >= limits.value.min);
// How many turns this table will play, and how many drawings that is each.
const turns = computed(() => props.state.turnsToPlay);
const drawings = computed(() => (props.state.players.length - 1) * settings.value.rounds);

/** The three settings, each with its bounds and the words that go round it. */
const dials = computed(() => [
  { key: 'rounds', value: settings.value.rounds, bounds: limits.value.rounds, label: t('lobby.rounds', { count: settings.value.rounds }, settings.value.rounds), less: t('lobby.fewerRounds'), more: t('lobby.moreRounds') },
  { key: 'drawTime', value: settings.value.drawTime, bounds: limits.value.drawTime, step: 5, label: t('lobby.drawTime', { count: settings.value.drawTime }), less: t('lobby.fasterDrawing'), more: t('lobby.slowerDrawing') },
  { key: 'wordChoices', value: settings.value.wordChoices, bounds: limits.value.wordChoices, label: t('lobby.choices', { count: settings.value.wordChoices }), less: t('lobby.fewerChoices'), more: t('lobby.moreChoices') },
]);
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
      :min="limits.min"
      :max="limits.max"
      :size="state.size"
      @size="(n) => send('settings', { size: n })"
      @add-bot="send('addBot')"
      @remove-bot="(slot) => send('removeBot', { slot })"
      @kick="(slot) => send('kick', { slot })"
      @fill-bots="(count) => send('fillBots', { count })"
    />

    <section class="panel stack">
      <div v-for="dial in dials" :key="dial.key" class="row">
        <button :disabled="!isHost || dial.value <= dial.bounds.min" :aria-label="dial.less" @click="send('settings', { [dial.key]: dial.value - (dial.step ?? 1) })">-</button>
        <strong>{{ dial.label }}</strong>
        <button :disabled="!isHost || dial.value >= dial.bounds.max" :aria-label="dial.more" @click="send('settings', { [dial.key]: dial.value + (dial.step ?? 1) })">+</button>
      </div>
      <p v-if="canStart" class="muted">{{ t('lobby.length', { turns, drawings }) }}</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ $t('lobby.start') }}</button>
        <span v-if="isHost && !canStart" class="muted">{{ $t('errors.minPlayers', { min: limits.min }) }}</span>
        <span v-if="!isHost" class="muted">{{ t('lobby.waitingForHost') }}</span>
      </div>
    </section>
  </div>
</template>
