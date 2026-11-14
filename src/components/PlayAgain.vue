<script setup>
// The host's "Play again" button, for the Status box of a game that is over: it sends the table back to the lobby
// with the same code, people, and settings (the shared `again` event; see `backToLobby` in shared/roster.js).  It
// draws nothing for anybody but the host, and nothing while a game is being played, so a table can put it in its
// Status box unconditionally.
// Depends on: src/useGameText.js (its word is the site's, `table.playAgain`).
// Props: state (the view: its `phase`, `hostId`, and `you`).
// Emits: again (the host asked for another game; the table sends it on).  Slots: none.
// Side effects: none.
import { computed } from 'vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({ state: { type: Object, required: true } });
defineEmits(['again']);
const { t } = useGameText();

// The game is over, and this viewer is the one who may start another.
const offered = computed(() => ['finished', 'abandoned'].includes(props.state.phase) && props.state.hostId !== undefined && props.state.hostId === props.state.you);
</script>

<template>
  <div v-if="offered" class="play-again row">
    <button type="button" class="primary" @click="$emit('again')">{{ t('table.playAgain') }}</button>
  </div>
</template>
