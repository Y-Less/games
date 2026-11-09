<script setup>
// File: the players panel of seatless waiting rooms.  Depends on: BotIcon.vue.
// Props: players (Array of { id, name, bot?, online? }), you (Number|String, own id), hostId (Number|String), isHost (Boolean,
//   shows the Add / Remove / Fill buttons), min and max (Number, player-count limits).
// Emits: addBot, removeBot(id), kick(id), fillBots(count): the parent lobby does the real work.  `count` is the game's
//   own minimum, or FILL_AT_LEAST where that minimum is smaller (see below).
// Slots: lead (per player, scoped { player }, shown before the name), default (extra content at the bottom of the panel).
// Side effects: none itself; only emits events.
// The "Players (n of max)" panel of a waiting room whose players are not tied to numbered seats: each player with their
// tags, the host's Remove buttons, and the host's Add / Fill with computer players buttons.  A game's own per-player
// extras go in the #lead slot (shown before the name, e.g. a colour chip; it gets the `player`).
// Players: [{ id, name, bot?, online? }].  Emits addBot, removeBot(id), kick(id), fillBots(count): the lobby does the sending.
import { computed } from 'vue';
import BotIcon from './BotIcon.vue';

const props = defineProps({
  players: { type: Array, required: true },
  you: { type: [Number, String], default: null },
  hostId: { type: [Number, String], default: null },
  isHost: { type: Boolean, default: false },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  size: { type: Number, default: 0 },
});
const emit = defineEmits(['addBot', 'removeBot', 'kick', 'fillBots', 'size']);

// How many this room will hold: the host's cap, or the whole game when they have not set one.
const cap = computed(() => (props.size >= props.min ? props.size : props.max));
// The cap may not be lowered past the people already here, nor below what the game needs, nor above what it allows.
const capFloor = computed(() => Math.max(props.min, props.players.length));

/**
 * How many players "fill with computer players" makes up to: a comfortable table of four rather than as many as the
 * game could possibly hold, which in a game for twelve would be a surprise.  It is the same number the rules use
 * (shared/roster.js defaultPlayers), and it is never below the game's own minimum or above a cap the host has set.
 */
const FILL_TO = 4;
const fillTo = computed(() => Math.min(cap.value, props.max, Math.max(props.min, FILL_TO)));
</script>

<template>
  <section class="panel stack">
    <h3>{{ $t('lobby.playersCount', { count: players.length, max: cap }) }}</h3>
    <div v-if="isHost" class="row cap">
      <button :disabled="cap <= capFloor" :aria-label="$t('lobby.fewerPlayers')" @click="emit('size', cap - 1)">-</button>
      <span class="muted">{{ $t('lobby.roomFor', { count: cap }, cap) }}</span>
      <button :disabled="cap >= max" :aria-label="$t('lobby.morePlayers')" @click="emit('size', cap + 1)">+</button>
    </div>
    <ul class="players">
      <li v-for="p in players" :key="p.id" class="row">
        <slot name="lead" :player="p" />
        <span class="name">{{ p.name }}<span v-if="p.id === you" class="muted"> {{ $t('common.youBracketed') }}</span></span>
        <span v-if="p.bot" class="muted bot-tag"><BotIcon :size="16" /> {{ $t('common.computer') }}</span>
        <span v-if="p.id === hostId" class="muted">{{ $t('common.host') }}</span>
        <span v-if="!p.online" class="muted">{{ $t('common.away') }}</span>
        <button v-if="isHost && p.bot" class="quiet" @click="emit('removeBot', p.slot)">{{ $t('common.remove') }}</button>
        <button v-else-if="isHost && p.id !== you" class="quiet" @click="emit('kick', p.slot)">{{ $t('common.remove') }}</button>
      </li>
    </ul>
    <div v-if="isHost" class="row bots">
      <button :disabled="players.length >= cap" @click="emit('addBot')">{{ $t('lobby.addBot') }}</button>
      <button v-if="players.length < fillTo" @click="emit('fillBots', fillTo)">{{ $t('lobby.fillUpTo', { count: fillTo }, fillTo) }}</button>
      <span v-if="players.length >= cap" class="muted">{{ $t('lobby.tableFull', { count: cap }, cap) }}</span>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.bots {
  flex-wrap: wrap;
}
.bot-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.players {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
