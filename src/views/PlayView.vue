<script setup>
// Hosts one game module inside the site's play field. The module's client half (modules/<id>/client/index.js) is a
// Vue component; the shell gives it a connected socket for its own namespace and the signed-in user.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
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

// Fit the game to the window: the game is drawn at its natural size, and if that is taller than the room below the
// title it is scaled down (never up) so the page does not need to scroll while playing. The natural height only ever
// grows within a window size, so the scale settles instead of bouncing as panels come and go.
const frame = ref(null);
const MIN_SCALE = 0.55;
let natural = 0;
let observer = null;
function fit() {
  const el = frame.value;
  const inner = el?.firstElementChild;
  if (!el || !inner || !el.offsetParent) return;
  const current = Number.parseFloat(el.style.zoom) || 1;
  natural = Math.max(natural, inner.getBoundingClientRect().height / current);
  const top = el.getBoundingClientRect().top + window.scrollY;
  const room = window.innerHeight - top - 12;
  const scale = natural > 0 ? Math.min(1, Math.max(MIN_SCALE, room / natural)) : 1;
  const next = Math.floor(scale * 100) / 100;
  if (Math.abs(next - current) >= 0.01) {
    el.style.zoom = String(next);
    el.style.setProperty('--fit-zoom', String(next)); // sticky bars inside the game divide their offset by this
  }
}
function refit() {
  natural = 0;
  fit();
}
onMounted(() => {
  window.addEventListener('resize', refit);
  observer = new ResizeObserver(fit);
});
watch(frame, (el, old) => {
  if (old) observer?.unobserve(old.firstElementChild ?? old);
  if (el?.firstElementChild) observer?.observe(el.firstElementChild);
  else if (el) new MutationObserver((_, self) => el.firstElementChild && (observer.observe(el.firstElementChild), self.disconnect())).observe(el, { childList: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', refit);
  observer?.disconnect();
});
</script>

<template>
  <section class="play stack">
    <div v-if="meta" class="top row">
      <h1>{{ meta.name }}</h1>
      <button v-if="meta.rules" class="quiet" @click="openRules">Rules</button>
    </div>

    <p v-if="problem" class="panel" role="alert">{{ problem }}</p>
    <div v-else-if="socket && !connected" class="panel muted">Connecting…</div>

    <div v-if="socket && GameComponent" v-show="connected" ref="frame" class="field-frame">
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
/* The game is played directly on the user's chosen background: no panel, scrim or frame behind it. */
.field-frame {
  min-height: 0;
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
