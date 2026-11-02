<script setup>
// Hosts one game module inside the site's play field.  The module's client half (modules/<id>/client/index.js) is a
// Vue component; the shell gives it a connected socket for its own namespace and the signed-in user.
// Props: game (string, required): the module id from the route.  Emits: none.  Slots: none.
// Depends on: session.js, playBar.js, useFrameFit.js, useGameRules.js, useModuleSocket.js, HelpDialog.vue, and the modules'
// client entry points (found with import.meta.glob).
// Side effects: opens the module's socket; publishes the game's title and Help button to playBar (cleared on unmount);
// provides the module id (GAME_ID) to everything drawn inside.
import { computed, defineAsyncComponent, onBeforeUnmount, provide, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { session } from '../session.js';
import { playBar } from '../playBar.js';
import { useFrameFit } from '../useFrameFit.js';
import { useGameRules } from '../useGameRules.js';
import { useModuleSocket } from '../useModuleSocket.js';
import { catalogue } from '../catalogueText.js';
import { GAME_ID } from '../useGameText.js';
import HelpDialog from '../components/HelpDialog.vue';

const props = defineProps({ game: { type: String, required: true } });
const router = useRouter();
// Every component of the game, and every shared component drawn in it, finds the game's own words through this.
provide(GAME_ID, props.game);

// Every module's client entry, loaded lazily; the glob is resolved at build time.
const loaders = import.meta.glob('../../modules/*/client/index.js');
// The game's entry from the config (null when unknown).
const meta = computed(() => session.games.find((g) => g.id === props.game) ?? null);
// The loader for this module's client, or undefined when it has none.
const loader = loaders[`../../modules/${props.game}/client/index.js`];
// The module's client component, or null when it is not available.
const GameComponent = loader ? defineAsyncComponent(loader) : null;

const { socket, connected, problem } = useModuleSocket(() => props.game, {
  available: () => Boolean(meta.value && GameComponent),
  onSignedOut: () => router.push({ name: 'login', query: { next: router.currentRoute.value.fullPath } }),
});
const { rules, showRules, openRules } = useGameRules(() => props.game);
const { frame } = useFrameFit();

// The title and Help button live in the site header (App.vue), which reads them from playBar.
watchEffect(() => {
  playBar.game = meta.value ? { name: catalogue.gameName(meta.value), openRules } : null;
});
onBeforeUnmount(() => {
  playBar.game = null;
});

// Lets a module keep its own addresses (for example an invite link) without the shell reloading it.
/**
 * Changes the address bar's query string without reloading.
 * @param {string} search  the new query string, with or without the leading '?'
 * @returns {void}
 * Side effects: replaces the history entry.
 */
const setSearch = (search) => window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search.replace(/^\?/, '')}` : ''}`);
const search = window.location.search; // the address's query string when the page opened (an invite code, say)
</script>

<template>
  <section class="play stack">
    <p v-if="problem" class="panel" role="alert">{{ problem }}</p>
    <div v-else-if="socket && !connected" class="panel muted">{{ $t('play.connecting') }}</div>

    <div v-if="socket && GameComponent" v-show="connected" ref="frame" class="field-frame">
      <GameComponent :socket="socket" :user="session.user" :search="search" :set-search="setSearch" />
    </div>

    <HelpDialog v-if="showRules" :html="rules" @close="showRules = false" />
  </section>
</template>

<style scoped>
/* The game is played directly on the user's chosen background: no panel, scrim, or frame behind it. */
.field-frame {
  min-height: 0;
}
</style>
