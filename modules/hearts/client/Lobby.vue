<script setup>
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const isHost = computed(() => props.state.hostSeat === props.state.you);
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
const seatCounts = computed(() => Array.from({ length: props.state.limits.maxSeats - props.state.limits.minSeats + 1 }, (_, i) => props.state.limits.minSeats + i));
const taken = computed(() => props.state.seats.filter(Boolean).length);
const numberWord = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
// One line about the deal for the chosen number of players, e.g. "Five players: 10 cards each, 2C and 2D removed, pass 3 cards".
const dealing = computed(() => {
  const { cardsEach, removed, passCount } = props.state.deal;
  const out = removed.length ? `, ${removed.length > 1 ? `${removed.slice(0, -1).join(', ')} and ${removed.at(-1)}` : removed[0]} removed` : ', none removed';
  return `${numberWord[props.state.seatCount]} players: ${cardsEach} cards each${out}, pass ${passCount} cards.`;
});
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
const moonText = { others: 'Everyone else scores +26', self: 'The shooter scores -26' };
const change = (settings) => props.send('settings', settings);
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <p class="muted">Share this code, or the invite link, with your friends. Empty seats can be filled by computer players.</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <SeatLobby
      :seats="seats"
      :is-host="isHost"
      @add-bot="send('addBot', { seat: firstEmpty() })"
      @remove-bot="(id) => send('removeBot', { seat: id })"
      @fill-bots="send('fillBots')"
      @kick="(id) => send('kick', { seat: id })"
      @start="send('start')"
    >
      <template #settings>
        <h3>Rules for this game</h3>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">Players</legend>
          <div class="row">
            <button v-for="n in seatCounts" :key="n" :class="{ primary: state.seatCount === n }" :disabled="n < taken" :aria-pressed="state.seatCount === n" @click="change({ seats: n })">{{ n }}</button>
          </div>
          <p class="muted deal">{{ dealing }}</p>
        </fieldset>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">Play to</legend>
          <div class="row">
            <button v-for="t in state.limits.targets" :key="t" :class="{ primary: state.settings.target === t }" :aria-pressed="state.settings.target === t" @click="change({ target: t })">{{ t }} points</button>
          </div>
        </fieldset>
        <label class="check">
          <input type="checkbox" :checked="state.settings.jackOfDiamonds" :disabled="!isHost" @change="change({ jackOfDiamonds: $event.target.checked })" />
          <span>Jack of Diamonds is worth -5 to whoever takes it</span>
        </label>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">Shooting the moon (all the hearts and the Queen of Spades)</legend>
          <div class="row">
            <button v-for="mode in state.limits.moonModes" :key="mode" :class="{ primary: state.settings.moon === mode }" :aria-pressed="state.settings.moon === mode" @click="change({ moon: mode })">{{ moonText[mode] }}</button>
          </div>
        </fieldset>
        <p v-if="!isHost" class="muted">Only the host can change these.</p>
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
