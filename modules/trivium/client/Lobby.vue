<script setup>
// The waiting room: the invite code, the players with their marker colours, and the host's two settings (how many
// rounds, and how many questions in each).
// Props: state (the server view), send (sends an action to the server).
// Emits: none (everything goes through `send`).  Slots: none.
// Side effects: the buttons send add/remove bot, kick, colour, settings and start requests.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True if you are the host (only the host may change the settings).
const isHost = computed(() => props.state.hostId === props.state.you);
// The marker colours already chosen, so the picker can show them as unavailable.
const taken = computed(() => new Set(props.state.players.map((p) => p.colour)));
// Your own player record.
const mine = computed(() => props.state.players.find((p) => p.id === props.state.you));
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
.swatch-pick {
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--line);
}
.swatch-pick.chosen {
  outline: 3px solid var(--amber);
  outline-offset: 2px;
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
</style>
