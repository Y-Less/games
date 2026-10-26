<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { session, signOut } from './session.js';
import { leaveOffer, playBar } from './playBar.js';

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const playing = computed(() => route.name === 'play');
const offer = computed(() => (playing.value ? leaveOffer() : null));
const confirming = ref(false);
watch(offer, (now) => {
  if (!now) confirming.value = false;
});
function askLeave() {
  if (offer.value?.confirmText) confirming.value = true;
  else doLeave();
}
async function doLeave() {
  confirming.value = false;
  await offer.value?.leave();
}

async function leaveSite() {
  menuOpen.value = false;
  await signOut();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="site">
    <header class="bar">
      <RouterLink to="/" class="brand">Game Hub</RouterLink>
      <nav v-if="session.user" class="links" aria-label="Main">
        <RouterLink to="/" :class="{ on: route.name === 'games' || playing }">Games</RouterLink>
        <RouterLink to="/stats" :class="{ on: route.name === 'stats' }">Statistics</RouterLink>
      </nav>

      <div v-if="playing && playBar.game" class="game-bar">
        <div v-if="offer" class="leave">
          <button class="quiet" :aria-expanded="confirming" @click="askLeave">Leave game</button>
          <div v-if="confirming" class="confirm panel" role="alertdialog" aria-label="Leave game">
            <p>{{ offer.confirmText }}</p>
            <div class="row">
              <button class="primary" @click="doLeave">Yes, leave</button>
              <button class="quiet" @click="confirming = false">Stay</button>
            </div>
          </div>
        </div>
        <h1 class="game-title">{{ playBar.game.name }}</h1>
        <button v-if="playBar.game.hasRules" class="quiet" @click="playBar.game.openRules()">Rules</button>
      </div>

      <div v-if="session.user" class="account">
        <button class="quiet" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">{{ session.user.displayName }} ▾</button>
        <div v-if="menuOpen" class="dropdown panel" @click="menuOpen = false">
          <RouterLink to="/profile">Profile and background</RouterLink>
          <RouterLink to="/stats">My statistics</RouterLink>
          <button class="quiet" @click="leaveSite">Sign out</button>
        </div>
      </div>
    </header>

    <main class="field">
      <RouterView :key="route.fullPath.split('?')[0]" />
    </main>
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.bar {
  min-width: 0;
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.55rem 1rem;
  background: rgb(14 26 32 / 0.88);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.brand {
  font-family: var(--display);
  font-size: 1.3rem;
  font-weight: 650;
  color: var(--amber);
  text-decoration: none;
}
.links {
  display: flex;
  gap: 0.2rem;
}
.links a {
  color: var(--parchment);
  text-decoration: none;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
}
.links a:hover,
.links a.on {
  background: var(--bg-raised);
}
.game-bar {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}
.game-title {
  color: var(--amber);
  font-size: 1.35rem;
  white-space: nowrap;
}
.game-bar button {
  padding: 0.3rem 0.9rem;
}
.game-bar + .account {
  margin-left: 0;
}
.leave {
  position: relative;
}
.confirm {
  position: absolute;
  right: 0;
  top: calc(100% + 0.4rem);
  width: 18rem;
  background: var(--bg-raised);
  z-index: 30;
}
.confirm p {
  margin: 0 0 0.6rem;
}
@media (max-width: 640px) {
  .bar {
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
  }
  .links a {
    padding: 0.35rem 0.55rem;
  }
  .account button {
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.account {
  margin-left: auto;
  position: relative;
}
.dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 0.4rem);
  min-width: 14rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  background: var(--bg-raised);
}
.dropdown a,
.dropdown button {
  color: var(--parchment);
  text-decoration: none;
  text-align: left;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  border: none;
}
.dropdown a:hover,
.dropdown button:hover {
  background: #28434f;
}
.field {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0.5rem auto 0.75rem;
  padding: 0 1rem;
}
</style>
