<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import AchievementPopups from './components/AchievementPopups.vue';
import BackgroundFx from './components/BackgroundFx.vue';
import AvatarFigure from './components/AvatarFigure.vue';
import StyledName from './components/StyledName.vue';
import { refreshShop, session, signOut } from './session.js';
import { leaveOffer, playBar } from './playBar.js';

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const playing = computed(() => route.name === 'play');
const offer = computed(() => (playing.value ? leaveOffer() : null));
const confirming = ref(false);
// Coins can change whenever a game ends, so the balance is read again on every page change.
watch(() => route.fullPath, () => refreshShop());
watch(offer, (now) => {
  if (!now) confirming.value = false;
});
function askLeave() {
  if (offer.value?.confirmText) confirming.value = true;
  else doLeave();
}
async function doLeave() {
  confirming.value = false;
  // The game's own screen takes over once you have left: its lobby, where you can start or join another game.
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
    <BackgroundFx fixed :effect="session.user?.backgroundAnimation" :background="session.user?.background" :intensity="session.user?.effectIntensity" :speed="session.user?.effectSpeed" />
    <header class="bar">
      <RouterLink to="/" class="brand">Game Hub</RouterLink>
      <nav v-if="session.user" class="links" :class="{ 'in-game': playing }" aria-label="Main">
        <RouterLink to="/" :class="{ on: route.name === 'games' || playing }">Games</RouterLink>
        <RouterLink to="/stats" class="optional" :class="{ on: route.name === 'stats' }">Statistics</RouterLink>
        <RouterLink to="/achievements" class="optional" :class="{ on: route.name === 'achievements' }">Achievements</RouterLink>
        <RouterLink to="/shop" class="optional" :class="{ on: route.name === 'shop' }">Shop</RouterLink>
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

      <RouterLink v-if="session.user && session.shop" to="/shop" class="coins" :class="{ 'in-game': playing }" :title="`${session.shop.balance} coins: spend them in the shop`" aria-label="Your coins">
        <span class="coin" aria-hidden="true" />{{ session.shop.balance }}
      </RouterLink>
      <div v-if="session.user" class="account">
        <StyledName as="button" class="quiet" :name="session.user.displayName" :user-id="session.user.id" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"> ▾</StyledName>
        <div v-if="menuOpen" class="dropdown panel" @click="menuOpen = false">
          <AvatarFigure class="my-avatar" :avatar="session.user.avatar" size="5rem" label="Your avatar" />
          <RouterLink to="/profile">Profile</RouterLink>
          <RouterLink to="/shop">Shop</RouterLink>
          <RouterLink to="/stats">My statistics</RouterLink>
          <RouterLink to="/achievements">Achievements</RouterLink>
          <button class="quiet" @click="leaveSite">Sign out</button>
        </div>
      </div>
    </header>

    <AchievementPopups />

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
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
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
.coins {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  color: var(--amber);
  text-decoration: none;
  font-variant-numeric: tabular-nums;
}
.coin {
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ffe08a, #c79a3b 70%);
  box-shadow: inset 0 0 0 2px #9c7425;
}
.coins + .account,
.game-bar + .coins {
  margin-left: 0;
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
  /* The Games link already goes home, so the name makes room. */
  .brand {
    display: none;
  }
  .links a {
    padding: 0.35rem 0.5rem;
    font-size: 0.92rem;
  }
  .account > .styled-name.styled {
    padding: 0.4rem 0.7rem;
  }
  .account button {
    max-width: 6.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
/* On the narrowest phones the menu has Statistics, Achievements and Shop (and the coin count links to the shop), so the bar keeps just Games. */
@media (max-width: 420px) {
  .links .optional {
    display: none;
  }
}
/* On a phone, a game's title, Leave and Rules need the room more than the links and the coin count do (the account menu
   still has them, and the title shortens with an ellipsis if it must). */
@media (max-width: 640px) {
  .links.in-game,
  .coins.in-game {
    display: none;
  }
  .game-bar {
    flex: 1;
    gap: 0.4rem;
  }
  .game-bar button {
    padding: 0.3rem 0.6rem;
  }
  .game-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 1.05rem;
  }
}
.account {
  margin-left: auto;
  position: relative;
}
/* Your avatar, centred at the top of the menu. */
.my-avatar {
  align-self: center;
  margin: 0.2rem 0 0.3rem;
}
/* The whole menu button wears your name style and animation, border and all. */
.account > .styled-name.styled {
  padding: 0.5rem 1rem;
  font: inherit;
  cursor: pointer;
  line-height: 1.3;
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
  background: color-mix(in srgb, var(--bg-raised), var(--line) 50%);
}
.field {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0.5rem auto 0.75rem;
  padding: 0 1rem;
}
</style>
