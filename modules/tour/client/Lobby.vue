<script setup>
// The waiting room of a tour: the invite code, the player list, and what the table will be offered once it starts.
// Props: state (the server's lobby view), send (function: (event, payload) -> Promise<{ ok, error }>).  Emits: none.  Slots: none.
// Side effects: the buttons send 'start'; the player list sends 'addBot', 'removeBot', 'kick', 'fillBots' and 'settings'.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// How many games this many people could be offered.  The server works it out: the client never sees the catalogue.
const suitable = computed(() => props.state.suitable ?? 0);
// Enough people, and something for them to play.
const canStart = computed(() => props.state.players.length >= props.state.min && suitable.value > 0);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <h2>{{ t('lobby.title') }}</h2>
      <p class="muted">{{ t('lobby.intro') }}</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <PlayerListPanel
      :players="state.players"
      :you="state.you"
      :host-id="state.hostId"
      :is-host="state.isHost"
      :min="state.min"
      :max="state.max"
      :size="state.size"
      @size="(n) => send('settings', { size: n })"
      @add-bot="send('addBot')"
      @remove-bot="(slot) => send('removeBot', { slot })"
      @kick="(slot) => send('kick', { slot })"
      @fill-bots="(count) => send('fillBots', { count })"
    />

    <section class="panel stack">
      <p v-if="suitable" class="muted">{{ t('lobby.willOffer', { count: suitable, players: state.players.length }, suitable) }}</p>
      <p v-else class="muted warn">{{ t('lobby.none', { count: state.players.length }) }}</p>
      <div class="row">
        <button v-if="state.isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ t('lobby.start') }}</button>
        <span v-if="state.isHost && state.players.length < state.min" class="muted">{{ t('errors.minPlayers', { min: state.min }) }}</span>
        <span v-if="!state.isHost" class="muted">{{ t('status.waitingHost') }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.warn {
  color: var(--warn, inherit);
}
</style>
