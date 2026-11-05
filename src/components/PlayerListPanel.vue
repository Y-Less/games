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
});
const emit = defineEmits(['addBot', 'removeBot', 'kick', 'fillBots']);

/**
 * The fewest players the fill button is willing to leave a table with.  Several of these games can be played by two,
 * but two is a thin game of any of them - one opponent, and nobody to be quicker than - so filling offers a third.
 */
const FILL_AT_LEAST = 3;
// How many players "fill with computer players" makes up to: never below the game's own minimum, never above its maximum.
const fillTo = computed(() => Math.min(props.max, Math.max(props.min, FILL_AT_LEAST)));
</script>

<template>
  <section class="panel stack">
    <h3>{{ $t('lobby.playersCount', { count: players.length, max }) }}</h3>
    <ul class="players">
      <li v-for="p in players" :key="p.id" class="row">
        <slot name="lead" :player="p" />
        <span class="name">{{ p.name }}<span v-if="p.id === you" class="muted"> {{ $t('common.youBracketed') }}</span></span>
        <span v-if="p.bot" class="muted bot-tag"><BotIcon :size="16" /> {{ $t('common.computer') }}</span>
        <span v-if="p.id === hostId" class="muted">{{ $t('common.host') }}</span>
        <span v-if="!p.online" class="muted">{{ $t('common.away') }}</span>
        <button v-if="isHost && p.bot" class="quiet" @click="emit('removeBot', p.id)">{{ $t('common.remove') }}</button>
        <button v-else-if="isHost && p.id !== you" class="quiet" @click="emit('kick', p.id)">{{ $t('common.remove') }}</button>
      </li>
    </ul>
    <div v-if="isHost" class="row bots">
      <button :disabled="players.length >= max" @click="emit('addBot')">{{ $t('lobby.addBot') }}</button>
      <button v-if="players.length < min" @click="emit('fillBots', fillTo)">{{ $t('lobby.fillUpTo', { count: fillTo }, fillTo) }}</button>
      <span v-if="players.length >= max" class="muted">{{ $t('lobby.tableFull', { count: max }, max) }}</span>
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
