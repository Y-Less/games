<script setup>
// Hosts one game module inside the site's play field. The module's client half (modules/<id>/client/index.js) is a
// Vue component; the shell gives it a connected socket for its own namespace and the signed-in user.
import { computed, defineAsyncComponent, onBeforeUnmount, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { session } from '../session.js';
import { playBar } from '../playBar.js';
import { useFrameFit } from '../useFrameFit.js';
import { useGameRules } from '../useGameRules.js';
import { useModuleSocket } from '../useModuleSocket.js';
import HelpDialog from '../components/HelpDialog.vue';

const props = defineProps({ game: { type: String, required: true } });
const router = useRouter();

const loaders = import.meta.glob('../../modules/*/client/index.js');
const meta = computed(() => session.games.find((g) => g.id === props.game) ?? null);
const loader = loaders[`../../modules/${props.game}/client/index.js`];
const GameComponent = loader ? defineAsyncComponent(loader) : null;

const { socket, connected, problem } = useModuleSocket(() => props.game, {
  available: () => Boolean(meta.value && GameComponent),
  onSignedOut: () => router.push({ name: 'login', query: { next: router.currentRoute.value.fullPath } }),
});
const { rules, showRules, openRules } = useGameRules(() => props.game);
const { frame } = useFrameFit();

// The title and Help button live in the site header (App.vue), which reads them from playBar.
watchEffect(() => {
  playBar.game = meta.value ? { name: meta.value.name, hasRules: Boolean(meta.value.rules), openRules } : null;
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
const search = window.location.search;
</script>

<template>
  <section class="play stack">
    <p v-if="problem" class="panel" role="alert">{{ problem }}</p>
    <div v-else-if="socket && !connected" class="panel muted">Connecting…</div>

    <div v-if="socket && GameComponent" v-show="connected" ref="frame" class="field-frame">
      <GameComponent :socket="socket" :user="session.user" :search="search" :set-search="setSearch" />
    </div>

    <HelpDialog v-if="showRules" :html="rules" @close="showRules = false" />
  </section>
</template>

<style scoped>
/* The game is played directly on the user's chosen background: no panel, scrim or frame behind it. */
.field-frame {
  min-height: 0;
}
</style>
