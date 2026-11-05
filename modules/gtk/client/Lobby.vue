<script setup>
// The waiting room: the invite code, the player list (PlayerListPanel), and the host's game options.
// Props: state (the server's lobby view), send (function: (event, payload) -> Promise<{ ok, error }>).  Emits: none.  Slots: none.
// Side effects: the buttons send 'settings' and 'start'; the player list sends 'addBot', 'removeBot', 'kick', and 'fillBots'.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// Only the host may change the length of the game and start it.
const isHost = computed(() => props.state.hostId === props.state.you);
// The fewest and most rounds each player may be the subject of ({ min, max } from the server).
const rounds = computed(() => props.state.limits.rounds);
// The fewest and most questions a round may have ({ min, max } from the server).
const questions = computed(() => props.state.limits.questions);
// The shortest and longest time to answer, and the step the buttons move it by ({ min, max, step } from the server).
const time = computed(() => props.state.limits.time);
// Rounds in the whole game: everybody is the subject the same number of times.
const total = computed(() => props.state.roundsEach * props.state.players.length);
// There are enough players to start.
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
    />

    <section class="panel stack">
      <h3>{{ t('settings.length') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.roundsEach <= rounds.min" :aria-label="t('settings.fewerRounds')" @click="send('settings', { roundsEach: state.roundsEach - 1 })">-</button>
        <strong>{{ t('settings.roundsEach', { count: state.roundsEach }, state.roundsEach) }}</strong>
        <button :disabled="!isHost || state.roundsEach >= rounds.max" :aria-label="t('settings.moreRounds')" @click="send('settings', { roundsEach: state.roundsEach + 1 })">+</button>
      </div>
      <p class="muted">{{ t('settings.total', { count: total, players: state.players.length, questions: state.questionsPerRound }, total) }}</p>

      <h3>{{ t('settings.questions') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.questionsPerRound <= questions.min" :aria-label="t('settings.fewerQuestions')" @click="send('settings', { questionsPerRound: state.questionsPerRound - 1 })">-</button>
        <strong>{{ t('settings.questionsEach', { count: state.questionsPerRound }, state.questionsPerRound) }}</strong>
        <button :disabled="!isHost || state.questionsPerRound >= questions.max" :aria-label="t('settings.moreQuestions')" @click="send('settings', { questionsPerRound: state.questionsPerRound + 1 })">+</button>
      </div>

      <h3>{{ t('settings.time') }}</h3>
      <div class="row">
        <button :disabled="!isHost || state.seconds <= time.min" :aria-label="t('settings.lessTime')" @click="send('settings', { seconds: state.seconds - time.step })">-</button>
        <strong>{{ t('settings.secondsEach', { count: state.seconds }, state.seconds) }}</strong>
        <button :disabled="!isHost || state.seconds >= time.max" :aria-label="t('settings.moreTime')" @click="send('settings', { seconds: state.seconds + time.step })">+</button>
      </div>
      <p class="muted">{{ t('settings.timeNote') }}</p>

      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">{{ t('lobby.start') }}</button>
        <span v-if="isHost && !canStart" class="muted">{{ t('errors.minPlayers', { min: state.limits.min }) }}</span>
        <span v-if="!isHost" class="muted">{{ t('lobby.waitingForHost') }}</span>
      </div>
    </section>
  </div>
</template>
