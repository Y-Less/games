<script setup>
// Draw!: the screens drawn inside the site's play field.  The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
// GameShell draws the loading line, the "new game or invite code" screen, and the error toast, and hands the state to
// the lobby or the table below.  The table needs the socket itself, for the strokes of a drawing, which no view could
// carry; and because the whole game is a drawing in progress, a lost connection is worth saying out loud.
//
// Props:
//   socket     {Object}    required.  The platform's socket connection for this game.
//   user       {Object}    the signed-in user, or null (unused here; part of the module contract).
//   search     {string}    the page's current query string, used to pick up an invite code.
//   setSearch  {Function}  updates the page's query string (used to put the room code in the address bar).
// Emits: none.  Slots: none.
// Side effects: as GameShell.
import GameShell from '../../../src/components/GameShell.vue';
import { useGameText } from '../../../src/useGameText.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});
const { t } = useGameText();

// A computer player takes your place mid-game and carries on with your drawing, so leaving costs the table nothing.
const leaveConfirm = () => '';
</script>

<template>
  <div class="draw stack">
    <GameShell :socket="props.socket" :search="props.search" :set-search="props.setSearch" :leave-confirm="leaveConfirm" :noun="t('entry.noun')" :intro="t('entry.intro')">
      <template #lobby="{ state, send }"><Lobby :state="state" :send="send" /></template>
      <template #table="{ state, send }"><Table :state="state" :send="send" :socket="props.socket" /></template>
      <template #overlay="{ connected }">
        <Teleport to="body">
          <div v-if="!connected" class="offline" role="status">{{ t('table.offline') }}</div>
        </Teleport>
      </template>
    </GameShell>
  </div>
</template>
