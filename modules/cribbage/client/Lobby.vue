<script setup>
// Cribbage lobby: the invite code and seats (via the shared SeatLobby), plus the host's choice of seat count, the score
// to play to and the stinkhole rule, with a line describing how many cards the chosen seat count deals.
//
// Props:
//   state  {Object}    required.  The player's view (phase 'lobby'): code, seats, you, isHost, seatCount, target, stinkhole, limits.
//   send   {Function}  required. send(action, payload) asks the server to do something.
// Emits: none.
// Slots: none (fills SeatLobby's #settings slot).
// Side effects: only through `send`: addBot, removeBot, fillBots, kick, start, and settings requests.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// Every seat in order: a person or computer player, or an empty seat (null in the view) waiting to be filled.
const seats = computed(() =>
  props.state.seats.map((s, i) =>
    s
      ? { id: s.seat, name: s.name, kind: s.bot ? 'bot' : 'human', isHost: Boolean(s.host), isMe: s.seat === props.state.you, away: !s.bot && !s.online }
      : { id: null, name: '', kind: 'empty', index: i },
  ),
);
// How many seats are taken: the seat-count buttons below that number are disabled.
const taken = computed(() => props.state.seats.filter(Boolean).length);
// The scores the host may choose to play to.
const targets = computed(() => props.state.limits.targets);
// One sentence describing the deal for the people who are here, since the game will be for them (cribbage deals
// differently for 2, 3, 4 and 5 players).
const dealing = computed(() => t(`lobby.deal.${Math.max(props.state.limits.min, taken.value)}`));
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <p class="muted">{{ t('lobby.share') }}</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <SeatLobby
      :seats="seats"
      :is-host="state.isHost"
      :min="state.limits.min"
      :max="state.limits.max"
      :fill-to="state.limits.fillTo"
      @add-bot="send('addBot')"
      @remove-bot="(slot) => send('removeBot', { slot })"
      @fill-bots="(count) => send('fillBots', { count })"
      @kick="(slot) => send('kick', { slot })"
      @size="(n) => send('settings', { seats: n })"
      @start="send('start')"
    >
      <template #settings>
        <h3>{{ t('lobby.game') }}</h3>
        <div class="row">
          <span class="muted label">{{ t('lobby.playTo') }}</span>
          <button v-for="t in targets" :key="t" :class="{ primary: state.target === t }" :disabled="!state.isHost" :aria-pressed="state.target === t" @click="send('settings', { target: t })">{{ t }}</button>
        </div>
        <label class="check">
          <input type="checkbox" :checked="state.stinkhole === true" :disabled="!state.isHost" @change="send('settings', { stinkhole: $event.target.checked })" />
          <span>{{ t('lobby.stinkhole') }}<span class="muted"> {{ t('lobby.stinkholeNote') }}</span></span>
        </label>
        <p class="muted small">{{ dealing }}</p>
      </template>
    </SeatLobby>
  </div>
</template>

<style scoped>
.label {
  min-width: 4.5rem;
}
.small {
  margin: 0;
  font-size: 0.9rem;
}
</style>
