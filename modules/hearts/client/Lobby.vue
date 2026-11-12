<script setup>
// The Hearts lobby: the invite code, the seat list (shared SeatLobby), and the host's rules (number of players, target score,
// Jack of Diamonds, how shooting the moon scores).
// Props: state (the server's lobby view), send (function: (event, payload) -> Promise<{ ok, error }>).  Emits: none.
// Slots: none (it fills SeatLobby's `settings` slot).
// Side effects: the buttons and checkbox send 'settings'; the seat list sends 'addBot', 'removeBot', 'fillBots', 'kick', 'start'.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t, list } = useGameText();

// Only the host may change the rules and the seats.
const isHost = computed(() => props.state.hostSeat === props.state.you);
// The seats in the shape the shared seat list shows: name, kind, whether host, you, or away.
const seats = computed(() =>
  props.state.seats.map((seat, i) => ({
    id: i,
    name: seat?.name ?? '',
    kind: !seat ? 'empty' : seat.bot ? 'bot' : 'human',
    isHost: i === props.state.hostSeat,
    isMe: i === props.state.you,
    away: Boolean(seat && !seat.bot && !seat.online),
  })),
);
// How many seats are taken: who the game would be for if it began now.
const taken = computed(() => props.state.seats.filter(Boolean).length);
// One line about the deal for the people who are here, e.g. "Five players: 10 cards each, 2C and 2D removed, pass 3 cards".
const dealing = computed(() => {
  const { cardsEach, removed, passCount } = props.state.deal;
  return t('lobby.deal', {
    players: t(`number.${Math.max(props.state.limits.min, taken.value)}`),
    cardsEach,
    removed: removed.length ? t('lobby.removed', { cards: list(removed) }) : t('lobby.noneRemoved'),
    passCount,
  });
});
// The first empty seat, where a computer player is added (-1 if the table is full).
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
// The button wording for each way of scoring a shot at the moon.
const moonText = { others: 'lobby.moonOthers', self: 'lobby.moonSelf' };
// Sends changed rules to the server (the host only; the server checks); returns its promise.
const change = (settings) => props.send('settings', settings);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <p class="muted">{{ t('lobby.share') }}</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <SeatLobby
      :seats="seats"
      :is-host="isHost"
      :min="state.limits.min"
      :max="state.limits.max"
      :fill-to="state.limits.fillTo"
      @add-bot="send('addBot', { seat: firstEmpty() })"
      @remove-bot="(slot) => send('removeBot', { slot })"
      @fill-bots="(count) => send('fillBots', { count })"
      @kick="(slot) => send('kick', { slot })"
      @size="(n) => change({ seats: n })"
      @start="send('start')"
    >
      <template #settings>
        <h3>{{ t('lobby.rules') }}</h3>
        <p class="muted deal">{{ dealing }}</p>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">{{ t('lobby.playTo') }}</legend>
          <div class="row">
            <button v-for="target in state.limits.targets" :key="target" :class="{ primary: state.settings.target === target }" :aria-pressed="state.settings.target === target" @click="change({ target })">{{ t('lobby.points', { n: target }) }}</button>
          </div>
        </fieldset>
        <label class="check">
          <input type="checkbox" :checked="state.settings.jackOfDiamonds" :disabled="!isHost" @change="change({ jackOfDiamonds: $event.target.checked })" />
          <span>{{ t('lobby.jack') }}</span>
        </label>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">{{ t('lobby.moon') }}</legend>
          <div class="row">
            <button v-for="mode in state.limits.moonModes" :key="mode" :class="{ primary: state.settings.moon === mode }" :aria-pressed="state.settings.moon === mode" @click="change({ moon: mode })">{{ t(moonText[mode]) }}</button>
          </div>
        </fieldset>
        <p v-if="!isHost" class="muted">{{ t('lobby.hostOnly') }}</p>
      </template>
    </SeatLobby>
  </div>
</template>

<style scoped>
.group {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.group legend {
  padding: 0;
  margin-bottom: 0.4rem;
}
.deal {
  margin: 0.5rem 0 0;
  font-size: 0.9rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.check input {
  width: auto;
}
</style>
