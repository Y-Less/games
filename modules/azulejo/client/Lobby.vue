<script setup>
// Azulejo lobby: shows the invite code and the seats (via the shared SeatLobby, which also carries the table size and
// the computer players), and lets the host say whether the wall is "free".  Everyone else sees the settings read-only.
//
// Props:
//   state  {Object}    required.  The player's view of the game (phase 'lobby'): code, seats, you, hostSeat, size, limits, settings.
//   send   {Function}  required. send(action, payload) asks the server to do something.
// Emits: none.
// Slots: none (fills SeatLobby's #settings slot).
// Side effects: only through `send`: addBot, removeBot, fillBots, kick, start, size, settings requests.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';
import { useGameText } from '../../../src/useGameText.js';
import { FACTORY_TILES, PER_COLOUR } from '../rules.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

// True when this player is the host and so may change settings.
const isHost = computed(() => props.state.hostSeat === props.state.you);
// Seats in the shape SeatLobby wants: id, name, kind (empty/bot/human), host and own-seat flags, and whether a human is offline.
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
// Returns the index of the first empty seat (-1 if full), where an added bot goes.
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
// Number of occupied seats; the player count cannot be lowered below this.
const seated = computed(() => props.state.seats.filter(Boolean).length);
// Number of display plates for the people who are here, since the game will be for them (two per player plus one).
const plates = computed(() => 2 * seated.value + 1);
</script>

<template>
  <div class="stack lobby-wrap">
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
      @size="(n) => send('settings', { size: n })"
      @start="send('start')"
    >
      <template #settings>
        <h3>{{ t('lobby.rules') }}</h3>
        <p class="muted small">{{ t('lobby.plates', { plates, perPlate: FACTORY_TILES, tiles: state.limits.tiles, perColour: PER_COLOUR }) }}</p>
        <label class="check">
          <input type="checkbox" :checked="state.settings.freeWall" :disabled="!isHost" @change="send('settings', { freeWall: $event.target.checked })" />
          <span><strong>{{ t('freeWall') }}</strong> {{ t('lobby.offByDefault') }}</span>
        </label>
        <p class="muted small rule-note" role="status">{{ state.settings.freeWall ? t('lobby.freeWallOn') : t('lobby.freeWallOff') }}</p>
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
