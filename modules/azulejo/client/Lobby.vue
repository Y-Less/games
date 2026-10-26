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
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
const seated = computed(() => props.state.seats.filter(Boolean).length);
const plates = computed(() => 2 * props.state.size + 1);
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
          <p class="muted small">{{ plates }} display plates of four tiles each, from a bag of 100 tiles (20 of each colour).</p>
        </fieldset>
        <label class="check">
          <input type="checkbox" :checked="state.settings.freeWall" :disabled="!isHost" @change="send('settings', { freeWall: $event.target.checked })" />
          <span><strong>Free wall</strong> (off by default)</span>
        </label>
        <p class="muted small rule-note" role="status">
          <template v-if="state.settings.freeWall">The wall starts blank. When a line scores, its owner chooses the column for the tile in that row; no colour may repeat in a row or a column. A line can only be used while its row still has a free column for that colour.</template>
          <template v-else>The standard wall: every row is the row above shifted one place, and each colour has one fixed place in every row.</template>
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
