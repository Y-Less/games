<script setup>
// The Gaudi lobby: the invite code, the seat list and table size (shared SeatLobby), and the host's rules (bad private scoring).
// Props: state (the server's lobby view), send (function: (event, payload) -> Promise<{ ok, error }>).  Emits: none.
// Slots: none (it fills SeatLobby's `settings` slot).
// Side effects: the buttons and checkbox send 'settings', 'addBot', 'removeBot', 'fillBots', 'kick', and 'start'.
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t } = useGameText();

/**
 * Is this player the host?  Only the host may change the rules and the seats.
 * @returns {boolean}
 * Side effects: none.
 */
const isHost = computed(() => props.state.hostSeat === props.state.you);
/**
 * The seats in the shape the shared seat list shows: name, kind, whether host, you, or away.
 * @returns {{ id: number, name: string, kind: string, isHost: boolean, isMe: boolean, away: boolean }[]}
 * Side effects: none.
 */
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
/**
 * The first empty seat, where a computer player is added (-1 if the table is full).
 * @returns {number} the seat number or -1
 * Side effects: none.
 */
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
/**
 * A line saying how many dice the bag holds for this many seats (the bag is five colours of equal count, sized so that ten
 * rounds of a pool of 2n + 1 dice use every die).
 * @returns {string}
 * Side effects: none.
 */
// The dice the game would use if it began now: ten per display plate, two of each colour (two plates per player, plus one).
const diceLine = computed(() => t('lobby.dice', { dice: 10 * (2 * props.state.playing + 1), each: 2 * (2 * props.state.playing + 1) }));
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
        <p class="muted small">{{ diceLine }}</p>
        <label class="check">
          <input type="checkbox" :checked="state.settings.badPrivate" :disabled="!isHost" @change="send('settings', { badPrivate: $event.target.checked })" />
          <span><strong>{{ t('lobby.badPrivate') }}</strong> {{ t('lobby.badPrivateDefault') }}</span>
        </label>
        <p class="muted small rule-note" role="status">{{ t(state.settings.badPrivate ? 'lobby.badPrivateOn' : 'lobby.badPrivateOff') }}</p>
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
