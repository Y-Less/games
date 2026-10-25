<script setup>
// Hosts one game module inside the site's play field. The module's client half (modules/<id>/client/index.js) is a
// Vue component; the shell gives it a connected socket for its own namespace and the signed-in user.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { io } from 'socket.io-client';
import { api, session } from '../session.js';
import { renderMarkdown } from '../markdown.js';

const props = defineProps({ game: { type: String, required: true } });
const router = useRouter();

const loaders = import.meta.glob('../../modules/*/client/index.js');
const meta = computed(() => session.games.find((g) => g.id === props.game) ?? null);
const loader = loaders[`../../modules/${props.game}/client/index.js`];
const GameComponent = loader ? defineAsyncComponent(loader) : null;

const socket = shallowRef(null);
const connected = ref(false);
const problem = ref('');
const rules = ref(null); // rendered HTML once loaded
const showRules = ref(false);

onMounted(() => {
  if (!meta.value || !GameComponent) {
    problem.value = 'That game is not available.';
    return;
  }
  const s = io(`/${props.game}`);
  s.on('connect', () => {
    connected.value = true;
    problem.value = '';
  });
  s.on('disconnect', () => (connected.value = false));
  s.on('connect_error', (error) => {
    if (/sign in/i.test(error.message)) {
      session.user = null;
      router.push({ name: 'login', query: { next: router.currentRoute.value.fullPath } });
    } else {
      problem.value = 'Could not reach the game. Trying again…';
    }
  });
  socket.value = s;
});
const closeRulesOnEsc = (event) => event.key === 'Escape' && (showRules.value = false);
onMounted(() => window.addEventListener('keydown', closeRulesOnEsc));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', closeRulesOnEsc);
  socket.value?.close();
});

async function openRules() {
  showRules.value = true;
  if (rules.value !== null) return;
  try {
    rules.value = renderMarkdown(await api('GET', `/api/games/${props.game}/rules`));
  } catch {
    rules.value = '<p>This game has no written rules yet.</p>';
  }
}

// Lets a module keep its own addresses (for example an invite link) without the shell reloading it.
const setSearch = (search) => window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search.replace(/^\?/, '')}` : ''}`);
const search = window.location.search;
</script>

<template>
  <section class="play stack">
    <div v-if="meta" class="top row">
      <h1>{{ meta.name }}</h1>
      <button v-if="meta.rules" class="quiet" @click="openRules">Rules</button>
    </div>

    <p v-if="problem" class="panel" role="alert">{{ problem }}</p>
    <div v-else-if="socket && !connected" class="panel muted">Connecting…</div>

    <div v-if="socket && GameComponent" v-show="connected" class="field-frame">
      <GameComponent :socket="socket" :user="session.user" :search="search" :set-search="setSearch" />
    </div>

    <div v-if="showRules" class="backdrop" @click.self="showRules = false">
      <div class="dialog panel" role="dialog" aria-label="Rules">
        <button class="quiet close" @click="showRules = false">Close</button>
        <h2>{{ meta.name }}: rules</h2>
        <div class="rules" v-html="rules ?? 'Loading…'" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.top h1 {
  color: var(--amber);
  font-size: 1.5rem;
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
/* The game's own area: a calm panel so any user background stays readable behind it. */
.field-frame {
  background: rgb(14 26 32 / 0.9);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem;
  min-height: 60vh;
}
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgb(0 0 0 / 0.6);
  display: grid;
  place-items: center;
  padding: 1rem;
}
.dialog {
  position: relative;
  max-width: 640px;
  max-height: 85vh;
  overflow: auto;
  background: var(--bg-raised);
}
.close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
}
.rules :deep(h2),
.rules :deep(h3),
.rules :deep(h4) {
  margin: 1rem 0 0.3rem;
  color: var(--amber);
}
.rules :deep(p),
.rules :deep(li) {
  line-height: 1.5;
}
</style>
