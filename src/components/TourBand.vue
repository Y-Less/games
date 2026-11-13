<script setup>
// File: a strip under the site header saying where the tour you are in has got to, with a link to wherever that is.
// Depends on: vue-router (the current page, and the link), ../tourSession.js (what the tour last said), ../session.js
//   (the game's name), ../catalogueText.js.
// Props: none.  Emits: none.  Slots: none.
// Side effects: none; the link is an ordinary route and hiding the band only clears the session's copy.
//
// It never moves anybody by itself.  A tour sends people between games, and being yanked off a final scoreboard you
// are still reading would be worse than having to click.
//
// Its words are under `tourBand.`, not `tour.`: each module's locale file is loaded under its own id, so `tour.` is
// the tour module's namespace and a site key of that name would be shadowed by it.  A module id cannot hold a capital
// letter, so `tourBand` is safe from any module that might be written later.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { catalogue } from '../catalogueText.js';
import { session } from '../session.js';
import { clearTour, tour } from '../tourSession.js';

const route = useRoute();

/** The address of the tour itself. */
const tourLink = computed(() => `/play/tour?${tour.code}`);
/** The address of the game the tour is playing, or '' when it is not playing one. */
const gameLink = computed(() => (tour.game && tour.gameCode ? `/play/${tour.game}?${tour.gameCode}` : ''));
/** The game's name in the player's language, or its id if the site does not know it. */
const gameName = computed(() => {
  const meta = session.games?.find((game) => game.id === tour.game);
  return meta ? catalogue.gameName(meta) : tour.game;
});

const onTour = computed(() => route.path === '/play/tour');
const onGame = computed(() => Boolean(tour.game) && route.path === `/play/${tour.game}`);
const playing = computed(() => tour.phase === 'playing' && Boolean(gameLink.value));

/**
 * The way the band offers, or null when there is nowhere worth offering.  There are two places a tour can put you —
 * the tour itself and the game it is playing — so the band points at whichever you are not looking at, and says
 * nothing at all when you are already where it would send you.
 */
const primary = computed(() => {
  if (playing.value && !onGame.value) return { to: gameLink.value, label: 'toGame' };
  if (onTour.value) return null;
  return { to: tourLink.value, label: playing.value ? 'toTour' : 'toVote' };
});
/** The tour, offered more quietly, when the band is pointing at the game and you are at neither. */
const secondary = computed(() => (playing.value && !onGame.value && !onTour.value ? tourLink.value : null));
/** Show it when there is a tour, you have not hidden it, and there is somewhere to go. */
const shown = computed(() => Boolean(tour.code) && !tour.dismissed && primary.value !== null);
</script>

<template>
  <aside v-if="shown" class="tour-band" role="status">
    <span class="what">
      <template v-if="tour.phase === 'playing'">{{ $t('tourBand.playing', { name: gameName }) }}</template>
      <template v-else-if="tour.phase === 'opening'">{{ $t('tourBand.opening') }}</template>
      <template v-else>{{ $t('tourBand.voting') }}</template>
    </span>
    <RouterLink class="button primary" :to="primary.to">{{ $t(`tourBand.${primary.label}`) }}</RouterLink>
    <RouterLink v-if="secondary" class="quiet-link" :to="secondary">{{ $t('tourBand.toTour') }}</RouterLink>
    <button type="button" class="quiet" :aria-label="$t('tourBand.hide')" @click="clearTour(true)">×</button>
  </aside>
</template>

<style scoped>
.tour-band {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.5rem 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius, 0.5rem);
  background: var(--raised);
}
.what {
  flex: 1;
  min-width: 12rem;
  overflow-wrap: anywhere;
}
.quiet-link {
  color: var(--muted);
}
</style>
