<script setup>
// Dixnt: the screens drawn inside the site's play field.  The server sends each player their own view of the game as
// a `state` event (null when not in a game); everything the player does is a request to the server (see
// useGameSocket).  GameShell draws the loading line, the "new game or invite code" screen, and the error toast, and
// hands off to the lobby or the game below, as in every other game.
//
// What is Dixnt's own here is the store (see store.js): the Recent moves, the word pop-up, and the card lightbox,
// worked out from each state as it arrives and shared with every component below, which reach it through
// useDixnt.js rather than through props.
//
// Props:
//   socket     {Object}    required.  The platform's socket connection for this game.
//   user       {Object}    required.  The signed-in user.
//   search     {string}    the page's current query string, used to pick up an invite code.
//   setSearch  {Function}  required.  Updates the page's query string (puts the game code in the address bar).
// Emits: none.  Slots: none.
// Side effects: as GameShell; creates the store and provides it under DIXNT_KEY.
import { computed, provide, ref } from 'vue';
import GameShell from '../../../src/components/GameShell.vue';
import YourTurnPopup from '../../../src/components/YourTurnPopup.vue';
import { useGameText } from '../../../src/useGameText.js';
import { createStore } from './store.js';
import { DIXNT_KEY } from './useDixnt.js';
import Game from './components/Game.vue';
import Lightbox from './components/Lightbox.vue';
import LobbyView from './components/LobbyView.vue';
import WordPopup from './components/WordPopup.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, required: true },
  search: { type: String, default: '' },
  setSearch: { type: Function, required: true },
});

const { t } = useGameText();
// The shared screen, which holds the room's state and sends the requests; the store reads both through it.
const shell = ref(null);
const dixnt = createStore({ shell, user: props.user });
provide(DIXNT_KEY, dixnt);
const { store } = dixnt;

// "Leave game" lives in the site's header, whenever you are in a game.  Mid-game it asks first: a computer player
// takes your place if anyone else is still playing, otherwise the game goes with you.
// @param {object} view  the current state; @returns {string} the warning, or '' when leaving is harmless.  No side effects.
const leaveConfirm = (view) => {
  if (['lobby', 'finished'].includes(view.phase)) return '';
  return t(view.players.some((p) => !p.bot && p.id !== view.you) ? 'leave.takenOver' : 'leave.scoreLost');
};

// Nobody in Dixnt is told it is their turn: everybody plays at once, and the chooser has the whole table waiting on
// them anyway.  The one small pop-up left is for the player who was kept in the dark, who is let in on the word as
// the voting opens ({ word, key } from the store, or null when there is nothing to tell).
const imposterWord = computed(() => store.imposterWord);
</script>

<template>
  <div class="dixnt stack">
    <GameShell
      ref="shell"
      :socket="props.socket"
      :search="props.search"
      :set-search="props.setSearch"
      :leave-confirm="leaveConfirm"
      :on-state="dixnt.onState"
      :noun="t('entry.noun')"
      :intro="t('entry.intro', { name: user.displayName })"
    >
      <template #lobby><LobbyView /></template>
      <template #table><Game /></template>
      <template #overlay="{ connected }">
        <Lightbox />
        <WordPopup v-if="store.state && store.state.phase !== 'lobby'" />
        <YourTurnPopup v-if="imposterWord" :key="imposterWord.key" :active="true" :message="t('table.imposterWord', { word: imposterWord.word })" />
        <Teleport to="body">
          <div v-if="!connected" class="offline" role="status">{{ t('table.offline') }}</div>
        </Teleport>
      </template>
    </GameShell>
  </div>
</template>

<style scoped>
.offline {
  position: fixed;
  top: 0.8rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  max-width: 92vw;
  text-align: center;
  background: var(--rust);
  color: #fff;
}
</style>
