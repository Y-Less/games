<script setup>
// A tour: the screens drawn inside the site's play field.  The server sends each player their own view as a `state`
// event (null when not in one); everything the player does is a request to the server (see useGameSocket).  GameShell
// draws the loading line, the "new tour or invite code" screen and the error toast, and hands the state to the lobby or
// to the table below.
//
// A tour's "table" is not a game: it is either a vote, a note that a game is being played somewhere else, or the end.
//
// Props:
//   socket     {Object}    required.  The platform's socket connection for this module.
//   user       {Object}    the signed-in user, or null (part of the module contract).
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

// Leaving a tour that is still choosing or playing loses your place in the rest of the evening, so it is worth asking.
const leaveConfirm = (state) => (['voting', 'opening', 'playing'].includes(state.phase) ? t('leaveConfirm') : '');
</script>

<template>
  <div class="tour stack">
    <GameShell :socket="props.socket" :search="props.search" :set-search="props.setSearch" :leave-confirm="leaveConfirm" :noun="t('entry.noun')" :intro="t('entry.intro')">
      <template #lobby="{ state, send }"><Lobby :state="state" :send="send" /></template>
      <template #table="{ state, send }"><Table :state="state" :send="send" /></template>
    </GameShell>
  </div>
</template>
