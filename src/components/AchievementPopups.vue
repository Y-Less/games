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
import { feed, shown, startFeed, stopFeed } from '../achievementFeed.js';
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
// Returns a number formatted with British thousands separators.
const number = (n) => n.toLocaleString('en-GB');
</script>

<template>
  <NoticePopup v-if="current" :key="current.map((u) => `${u.id}:${u.level}`).join()" :active="true" :auto-hide="false" :row="1" name="achievement" @close="closed">
    <template v-if="many">
      <strong class="title">{{ current.length }} achievements unlocked!</strong>
      <span class="line">+{{ number(coins) }} gold. See them on the Achievements page.</span>
    </template>
    <template v-else>
      <strong class="title">Achievement unlocked: {{ current[0].name }}</strong>
      <span class="line">{{ current[0].game }}{{ current[0].levels > 1 ? `, level ${current[0].level}` : '' }}: {{ current[0].text }}</span>
      <span class="line reward">+{{ number(current[0].coins) }} gold</span>
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
