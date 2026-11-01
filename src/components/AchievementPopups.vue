<script setup>
// File: shows achievement unlock pop-ups from the shared feed. Depends on: ../achievementFeed.js (queue, start/stop), ../session.js
//   (who is signed in), NoticePopup.vue.
// Props: none.  Emits: none.  Slots: none.
// Side effects: opens the achievement feed (site socket) when a user signs in and stops it on sign-out; marks shown unlocks as seen
//   via the feed's `shown()` when the player clicks OK.
// The pop-ups for achievement unlocks (see achievementFeed.js), one after another near the top of the page. They stay
// until OK is clicked (they do not hide themselves). When many arrive together (the first visit after achievements began paying out, say) they
// are shown as one pop-up with the total, so nobody has to click through a long line of them.
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { feed, shown, startFeed, stopFeed } from '../achievementFeed.js';
import { catalogue } from '../catalogueText.js';
import { session } from '../session.js';
import NoticePopup from './NoticePopup.vue';

const MOST_ONE_BY_ONE = 3; // more queued unlocks than this are merged into a single summary pop-up
const current = ref(null); // the unlocks in the pop-up being shown

watch(() => session.user?.id, (id) => {
  if (id) startFeed();
  else {
    stopFeed();
    current.value = null;
  }
}, { immediate: true });

// Takes the next pop-up when none is showing.
watch(() => [feed.queue.length, current.value], () => {
  if (current.value || !feed.queue.length) return;
  current.value = feed.queue.length > MOST_ONE_BY_ONE ? [...feed.queue] : [feed.queue[0]];
}, { immediate: true, deep: true });

/**
 * Called when the pop-up closes: records its unlocks as shown so they leave the queue, letting the next pop-up appear.
 * @returns {void}
 * Side effects: clears `current` and updates the feed via shown().
 */
function closed() {
  const done = current.value ?? [];
  current.value = null;
  shown(done);
}

// True when the current pop-up is a merged summary of several unlocks.
const many = computed(() => (current.value?.length ?? 0) > 1);
// Total coins earned across the unlocks in the current pop-up.
const coins = computed(() => (current.value ?? []).reduce((sum, u) => sum + u.coins, 0));
const { t, n: number } = useI18n();
/**
 * The pop-up's words for one unlock, in the player's language (the server's English is the fallback).
 * @param {{ gameId: string, key: string, name: string, text: string, n: number, level: number, levels: number, game: string }} unlock
 * @returns {{ name: string, line: string }}
 * Side effects: none.
 */
function wordsFor(unlock) {
  const name = catalogue.achievementName(unlock.gameId, unlock);
  const text = catalogue.achievementText(unlock.gameId, unlock, unlock.n, unlock.text);
  const game = unlock.gameId === 'global' ? unlock.game : catalogue.gameName({ id: unlock.gameId, name: unlock.game });
  return { name, line: unlock.levels > 1 ? t('unlocks.oneLineLevel', { game, level: unlock.level, text }) : t('unlocks.oneLine', { game, text }) };
}
</script>

<template>
  <NoticePopup v-if="current" :key="current.map((u) => `${u.id}:${u.level}`).join()" :active="true" :auto-hide="false" :row="1" name="achievement" @close="closed">
    <template v-if="many">
      <strong class="title">{{ t('unlocks.many', { count: current.length }) }}</strong>
      <span class="line">{{ t('unlocks.manyLine', { coins: number(coins) }) }}</span>
    </template>
    <template v-else>
      <strong class="title">{{ t('unlocks.one', { name: wordsFor(current[0]).name }) }}</strong>
      <span class="line">{{ wordsFor(current[0]).line }}</span>
      <span class="line reward">{{ t('unlocks.reward', { coins: number(current[0].coins) }) }}</span>
    </template>
  </NoticePopup>
</template>

<style scoped>
.title,
.line {
  display: block;
}
.title {
  font-size: 1.1rem;
}
.line {
  font-family: var(--body);
  font-size: 0.9rem;
  color: var(--muted);
}
.line.reward {
  color: var(--amber);
  font-weight: 650;
}
</style>
