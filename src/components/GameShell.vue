<script setup>
// The screen every game draws inside the site's play field, which was written out fourteen times before this.
//
// A game is one of three things at any moment: still loading, not in a game (so the player is offered a new room or an
// invite code), or in one (the lobby before it starts, the table after).  That shape is the same for every game; what
// differs is only which components draw the lobby and the table, what they need, and when leaving mid-game is worth a
// warning.  So the game passes its two screens as slots and keeps its own `send`, and everything else lives here.
//
// Dixnt is deliberately not written this way: its root component fills GameFrame's slots itself rather than handing off
// to a lobby and a table, so it has no use for the middle of this.
//
// Props:
//   socket        {Object}    required.  The platform's socket connection for this game.
//   search        {string}    the page's current query string, used to pick up an invite code.
//   setSearch     {Function}  updates the page's query string (used to put the room code in the address bar).
//   leaveConfirm  {Function}  (state) => string: the warning to show before leaving mid-game, or '' for none.
//   onState       {Function}  (next, previous) => void: for a game that works something out from each state as it
//                             arrives, such as the list of recent moves.  Runs before the slots are redrawn.
//   noun          {string}    what this game calls a game ("hand", "round"), for the "start a new one" screen.
//   intro         {string}    the line above that screen, in the game's own words.
//   lobbyPhase    {string}    the phase that means "not started yet" (default 'lobby').
//
// `noun` and `intro` are props rather than something this component looks up, because they are the *game's* words and
// a shared component is not part of any one game's translations: the i18n test reads each module's own files to decide
// which of its words are still in use, so a key asked for here would look unused everywhere.  RoomEntry takes them the
// same way round for the same reason.
// Slots: `lobby` and `table`, each given { state, send }, and `overlay`, given { connected }, for anything a game puts
//        over the top of the table while it is in a game (Draw's "you are offline" banner).
// Emits: none.
// Side effects: useGameSocket subscribes to the socket, sends create/join when the player asks, and installs the
// leave confirmation while a game is in progress.
import ErrorToast from './ErrorToast.vue';
import RoomEntry from './RoomEntry.vue';
import { useGameSocket } from '../useGameSocket.js';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  socket: { type: Object, required: true },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
  leaveConfirm: { type: Function, default: () => '' },
  onState: { type: Function, default: () => {} },
  noun: { type: String, default: '' },
  intro: { type: String, default: '' },
  lobbyPhase: { type: String, default: 'lobby' },
});
const { t } = useGameText();

const { state, loaded, busy, notice, connected, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  leaveConfirm: (current) => props.leaveConfirm(current),
  onState: (next, previous) => props.onState(next, previous),
});

defineExpose({ state, send });
</script>

<template>
  <p v-if="!loaded" class="muted">{{ t('play.loading') }}</p>
  <RoomEntry
    v-else-if="!state"
    :noun="noun"
    :intro="intro"
    :initial-code="initialCode"
    :busy="busy"
    :error="notice"
    @create="send('create')"
    @join="(code) => send('join', { code })"
  />
  <template v-else>
    <ErrorToast v-if="notice" :text="notice" />
    <slot v-if="state.phase === lobbyPhase" name="lobby" :state="state" :send="send" />
    <slot v-else name="table" :state="state" :send="send" />
    <slot name="overlay" :connected="connected" />
  </template>
</template>
