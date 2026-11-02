<script setup>
// The site shell: the header (title, menu, Help, Leave game, sign out), the routed page, the help pop-up and the
// achievement pop-ups.
// Props: none. Emits: none. Slots: none (the page is rendered by <RouterView>).
// Depends on: vue-router, session.js, shopStore.js, profiles.js, playBar.js, pageHelp.js, markdown.js and the shared components.
// Side effects: refreshes the shop on every page change; closes the help pop-up on navigation; signing out clears the
// profile cache and navigates to the sign-in page.
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import AchievementPopups from './components/AchievementPopups.vue';
import BackgroundFx from './components/BackgroundFx.vue';
import AvatarFigure from './components/AvatarFigure.vue';
import StyledName from './components/StyledName.vue';
import { clearProfiles } from './profiles.js';
import { session, signOut } from './session.js';
import { refreshShop } from './shopStore.js';
import { leaveOffer, playBar } from './playBar.js';
import HelpDialog from './components/HelpDialog.vue';
import { renderMarkdown } from './markdown.js';
import { pageHelp } from './pageHelp.js';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const menuOpen = ref(false); // the header's account menu
// Whether a game is on screen (the header then shows its title and the Help and Leave buttons).
const playing = computed(() => route.name === 'play');
// The leave button's registration from playBar (null when nothing to offer).
const offer = computed(() => (playing.value ? leaveOffer() : null));
const confirming = ref(false); // whether the "really leave?" prompt is showing
// Coins can change whenever a game ends, so the balance is read again on every page change.
watch(() => route.fullPath, () => refreshShop());
watch(offer, (now) => {
  if (!now) confirming.value = false;
});
// The session can end under a page (it expired, or the password was changed elsewhere; api.js clears the user): go
// to the sign-in page at once, remembering where we were, rather than leaving a page that cannot load anything.
watch(
  () => session.user,
  (user) => {
    if (!user && session.ready && !route.meta.public && route.name) router.replace({ name: 'login', query: { next: route.fullPath } });
  },
);
/**
 * The Leave game button: asks first when the game wants a confirmation, otherwise leaves.
 * @returns {void}
 * Side effects: shows the confirmation, or leaves.
 */
function askLeave() {
  if (offer.value?.confirmText) confirming.value = true;
  else doLeave();
}
// The Help button: a game's own rules while playing (the play view opens them), otherwise the page's help.
const helpOpen = ref(false);
// The current page's help ({ title, markdown }) or null, in the current language.
const help = computed(() => pageHelp(route, locale.value));
// The help text as safe HTML.
const helpHtml = computed(() => (help.value ? renderMarkdown(help.value.markdown) : `<p>${t('nav.noHelp')}</p>`));
watch(() => route.fullPath, () => (helpOpen.value = false));
/**
 * The Help button: the game's rules when playing, otherwise the page's help.
 * @returns {void}
 * Side effects: opens a pop-up.
 */
function openHelp() {
  if (playing.value && playBar.game) playBar.game.openRules();
  else helpOpen.value = true;
}
/**
 * Leaves the game.
 * @returns {Promise<void>}
 * Side effects: closes the confirmation and runs the game's own leave action.
 */
async function doLeave() {
  confirming.value = false;
  // The game's own screen takes over once you have left: its lobby, where you can start or join another game.
  await offer.value?.leave();
}

/**
 * Signs out and goes to the sign-in page.
 * @returns {Promise<void>}
 * Side effects: ends the session, forgets the other players' cached looks (so the next account does not see them),
 * closes the menu and navigates.
 */
async function leaveSite() {
  menuOpen.value = false;
  await signOut();
  clearProfiles();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="site">
    <BackgroundFx fixed :effect="session.user?.backgroundAnimation" :background="session.user?.background" :intensity="session.user?.effectIntensity" :speed="session.user?.effectSpeed" />
    <header class="bar">
      <RouterLink to="/" class="brand">
        <span class="brand-name">{{ $t('nav.brand') }}</span>
        <span class="tagline muted">{{ $t('nav.tagline') }}</span>
      </RouterLink>
      <nav v-if="session.user" class="links" :class="{ 'in-game': playing }" :aria-label="$t('nav.main')">
        <RouterLink to="/" :class="{ on: route.name === 'games' || playing }">{{ $t('nav.games') }}</RouterLink>
        <RouterLink to="/stats" class="optional" :class="{ on: route.name === 'stats' }">{{ $t('nav.stats') }}</RouterLink>
        <RouterLink to="/achievements" class="optional" :class="{ on: route.name === 'achievements' }">{{ $t('nav.achievements') }}</RouterLink>
        <RouterLink to="/shop" class="optional" :class="{ on: route.name === 'shop' }">{{ $t('nav.shop') }}</RouterLink>
      </nav>

      <div v-if="playing && playBar.game" class="game-bar">
        <div v-if="offer" class="leave">
          <button class="quiet" :aria-expanded="confirming" @click="askLeave">{{ $t('nav.leaveGame') }}</button>
          <div v-if="confirming" class="confirm panel" role="alertdialog" :aria-label="$t('nav.leaveGame')">
            <p>{{ offer.confirmText }}</p>
            <div class="row">
              <button class="primary" @click="doLeave">{{ $t('nav.yesLeave') }}</button>
              <button class="quiet" @click="confirming = false">{{ $t('nav.stay') }}</button>
            </div>
          </div>
        </div>
        <h1 class="game-title">{{ playBar.game.name }}</h1>
      </div>

      <button class="quiet help-button" :class="{ first: !playing }" @click="openHelp">{{ $t('common.help') }}</button>

      <RouterLink v-if="session.user && session.shop" to="/shop" class="coins" :class="{ 'in-game': playing }" :title="$t('nav.gold', { n: session.shop.balance })" :aria-label="$t('nav.yourGold')">
        <span class="coin" aria-hidden="true" />{{ session.shop.balance }}
      </RouterLink>
      <div v-if="session.user" class="account">
        <StyledName as="button" class="quiet" :name="session.user.displayName" :user-id="session.user.id" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"> ▾</StyledName>
        <div v-if="menuOpen" class="dropdown panel" @click="menuOpen = false">
          <AvatarFigure class="my-avatar" :avatar="session.user.avatar" size="5rem" :label="$t('nav.yourAvatar')" />
          <RouterLink to="/profile">{{ $t('nav.profile') }}</RouterLink>
          <RouterLink to="/shop">{{ $t('nav.shop') }}</RouterLink>
          <RouterLink to="/stats">{{ $t('nav.myStats') }}</RouterLink>
          <RouterLink to="/achievements">{{ $t('nav.achievements') }}</RouterLink>
          <button class="quiet" @click="leaveSite">{{ $t('nav.signOut') }}</button>
        </div>
      </div>
    </header>

    <HelpDialog v-if="helpOpen" :html="helpHtml" :title="help?.title ?? $t('common.help')" @close="helpOpen = false" />
    <AchievementPopups />

    <main class="field">
      <RouterView v-if="session.user || route.meta.public" :key="route.fullPath.split('?')[0]" />
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
/* The site's name with its line underneath: one link, stacked, whose height is the bar's own, so nothing else moves. */
.brand {
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.15;
  font-family: var(--display);
  font-weight: 650;
  color: var(--amber);
  text-decoration: none;
}
.brand-name {
  font-size: 1.3rem;
}
.brand .tagline {
  font-size: 0.72rem;
  font-weight: 400;
  white-space: nowrap;
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
.game-bar button,
.help-button {
  padding: 0.3rem 0.9rem;
}
/* Outside a game nothing else pushes the right-hand items across. */
.help-button.first {
  margin-left: auto;
}
.coins {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
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
/* A narrower bar needs the room more than the line under the name does; the name itself stays until 640px. */
@media (max-width: 900px) {
  .brand .tagline {
    display: none;
  }
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
  .game-bar button,
  .help-button {
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
