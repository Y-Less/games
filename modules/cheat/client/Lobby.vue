<script setup>
// Cheat lobby: the invite code and seats (via the shared SeatLobby), plus the host's choice of how many players sit
// (which also decides the number of packs and the deal).  Everyone else sees the choice read-only.
//
// Props:
//   state  {Object}    required.  The player's view (phase 'lobby'): code, seats, you, hostSeat, seatCount, decks, limits.
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
// One sentence describing the deal of the game that would be played now (packs, cards each, and any extra card).
const dealing = computed(() => {
  const players = props.state.playing;
  const cards = props.state.decks * 52;
  const each = Math.floor(cards / players);
  const extra = cards % players;
  const params = { players, packs: t(`lobby.packs.${props.state.decks}`), cardsEach: each };
  return extra ? t('lobby.dealExtra', { ...params, count: extra }, extra) : t('lobby.deal', params);
});
// Returns the index of the first empty seat (-1 if full), where an added bot goes.
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
// Asks the server to change settings; returns the request's promise.
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
</style>
