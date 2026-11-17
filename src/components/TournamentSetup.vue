<script setup>
// File: the offer of a tournament, under the ordinary lobby of every room-based game.  Depends on: Vue only.
//
// Tournament mode is a setting of the site rather than of any game (shared/tournamentRoom.js), so the toggle is here
// rather than in sixteen lobbies, and GameShell draws it under whichever lobby the game itself drew.  Switching it on
// changes what the whole screen is: see TournamentLobby.vue.
//
// Props: tournament (the `tournament` block of the state), isHost (Boolean).
// Emits: change({ on }) — the parent sends it as a settings message.
// Side effects: none itself; only emits.
import { useGameText } from '../useGameText.js';

const props = defineProps({
  tournament: { type: Object, required: true },
  isHost: { type: Boolean, default: false },
});
const { t } = useGameText();
const emit = defineEmits(['change']);
</script>

<template>
  <section class="panel stack tournament-setup">
    <h3>{{ t('tournament.title') }}</h3>
    <label class="check">
      <input type="checkbox" :checked="props.tournament.on" :disabled="!props.isHost" @change="emit('change', { on: $event.target.checked })" />
      <span>{{ t('tournament.toggle') }}</span>
    </label>
    <p class="muted">{{ t('tournament.explain') }}</p>
    <p v-if="!props.isHost" class="muted">{{ t('lobby.hostOnly') }}</p>
  </section>
</template>

<style scoped>
.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.check input {
  width: auto;
}
.tournament-setup h3 {
  margin: 0;
}
</style>
