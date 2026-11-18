<script setup>
// The screen every game draws inside the site's play field, which was written out fourteen times before this.
//
// A game is one of three things at any moment: still loading, not in a game (so the player is offered a new room or an
// invite code), or in one (the lobby before it starts, the table after).  That shape is the same for every game; what
// differs is only which components draw the lobby and the table, what they need, and when leaving mid-game is worth a
// warning.  So the game passes its two screens as slots and keeps its own `send`, and everything else lives here.
//
// A game whose components reach their state through a store of its own rather than through props (Dixnt) takes the
// state and the sender from this component's exposed `state` and `send`, through a ref to it.
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
import { computed } from 'vue';
import ErrorToast from './ErrorToast.vue';
import RoomEntry from './RoomEntry.vue';
import TournamentBar from './TournamentBar.vue';
import TournamentBoard from './TournamentBoard.vue';
import TournamentLobby from './TournamentLobby.vue';
import TournamentSetup from './TournamentSetup.vue';
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

// A room whose tournament is being set up or played is drawn by the site rather than by the game: its people are not
// at a table of it (see shared/tournamentRoom.js), so the game's own screens have nothing to draw.  A table of a
// tournament is an ordinary game of it, with the bar above it.
const isTournament = (view) => Boolean(view?.tournament?.on && !view.tournament.here);

const { state, loaded, busy, notice, connected, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  leaveConfirm: (current) => (isTournament(current) ? '' : props.leaveConfirm(current)),
  // A game works something out from each state as it arrives, and is given only states of its own: a tournament's is
  // not one it could read, and the one before it is another room's once somebody has walked between the two.
  onState: (next, previous) => props.onState(isTournament(next) ? null : next, isTournament(previous) || previous?.code !== next?.code ? null : previous),
});

/** The tournament this room is part of, or null. */
const tournament = computed(() => state.value?.tournament ?? null);
/** Is this the room a tournament is run from (rather than one of its games, or an ordinary room)? */
const running = computed(() => isTournament(state.value));
/**
 * Only the host sets a tournament up.  A game says who its host is in one of three ways — plainly, by account id, or
 * by seat — and a view that says none of them is nobody's: the server refuses either way, but a button nobody can
 * use should not be offered.
 */
const isHost = computed(() => {
  const view = state.value;
  if (!view) return false;
  if (typeof view.isHost === 'boolean') return view.isHost;
  if (view.you === undefined) return false;
  if (view.hostId !== undefined) return view.hostId === view.you;
  return view.hostSeat !== undefined && view.hostSeat === view.you;
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
    <TournamentBar v-if="tournament?.here" :tournament="tournament" :busy="busy" @go="(code) => send('join', { code })" />
    <template v-if="running">
      <TournamentLobby
        v-if="state.phase === lobbyPhase"
        :tournament="tournament"
        :code="state.code"
        :is-host="isHost"
        :busy="busy"
        @change="(table) => send('settings', { tournament: table })"
        @kick="(slot) => send('kick', { slot })"
        @start="send('start')"
      />
      <TournamentBoard v-else :tournament="tournament" :busy="busy" @go="(code) => send('join', { code })" />
    </template>
    <template v-else>
      <slot v-if="state.phase === lobbyPhase" name="lobby" :state="state" :send="send" />
      <slot v-else name="table" :state="state" :send="send" />
      <TournamentSetup v-if="tournament && !tournament.here && state.phase === lobbyPhase" :tournament="tournament" :is-host="isHost" @change="(table) => send('settings', { tournament: table })" />
      <slot name="overlay" :connected="connected" />
    </template>
  </template>
</template>
