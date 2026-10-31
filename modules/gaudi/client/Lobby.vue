<script setup>
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

/** Is this player the host? Only the host may change the rules and the seats. */
const isHost = computed(() => props.state.hostSeat === props.state.you);
/** The seats in the shape the shared seat list shows: name, kind, whether host, you, or away. */
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
/** The first empty seat, where a computer player is added (-1 if the table is full). */
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
/** How many seats are taken (the table cannot shrink below this). */
const seated = computed(() => props.state.seats.filter(Boolean).length);
/** A line saying how many dice the bag holds for this many seats. */
const diceLine = computed(() => `${10 * (2 * props.state.size + 1)} dice in the bag, ${2 * (2 * props.state.size + 1)} of each colour`);
</script>

<template>
  <div class="stack lobby-wrap">
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
          <legend class="muted">Players (seats)</legend>
          <div class="row">
            <button
              v-for="n in state.limits.sizes"
              :key="n"
              :class="{ primary: state.size === n }"
              :aria-pressed="state.size === n"
              :disabled="seated > n"
              :title="seated > n ? 'Remove some players first' : ''"
              @click="send('size', { seats: n })"
            >
              {{ n }} players
            </button>
          </div>
          <p class="muted small">{{ diceLine }}: exactly what ten rounds use.</p>
        </fieldset>
        <label class="check">
          <input type="checkbox" :checked="state.settings.badPrivate" :disabled="!isHost" @change="send('settings', { badPrivate: $event.target.checked })" />
          <span><strong>Bad private scoring</strong> (off by default)</span>
        </label>
        <p class="muted small rule-note" role="status">
          <template v-if="state.settings.badPrivate">The weaker rule applies: each die of your private colour is worth a flat 3 points, whatever it shows.</template>
          <template v-else>The normal rule applies: your private colour scores the shade of every die of that colour in your window, added up.</template>
        </p>
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
.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.check input {
  width: auto;
}
.small {
  font-size: 0.85rem;
  margin: 0.3rem 0 0;
}
.rule-note {
  margin: -0.4rem 0 0;
}
.lobby-wrap {
  max-width: 760px;
  margin: 0 auto;
}
</style>
