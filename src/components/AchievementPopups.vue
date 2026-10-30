<script setup>
// The pop-ups for achievement unlocks (see achievementFeed.js), one after another near the top of the page. They stay
// until OK is clicked (they do not hide themselves). When many arrive together (the first visit after achievements began paying out, say) they
// are shown as one pop-up with the total, so nobody has to click through a long line of them.
import { computed, ref, watch } from 'vue';
import { feed, shown, startFeed, stopFeed } from '../achievementFeed.js';
import { session } from '../session.js';
import NoticePopup from './NoticePopup.vue';

const MOST_ONE_BY_ONE = 3;
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

function closed() {
  const done = current.value ?? [];
  current.value = null;
  shown(done);
}

const many = computed(() => (current.value?.length ?? 0) > 1);
const coins = computed(() => (current.value ?? []).reduce((sum, u) => sum + u.coins, 0));
const number = (n) => n.toLocaleString('en-GB');
</script>

<template>
  <NoticePopup v-if="current" :key="current.map((u) => `${u.id}:${u.level}`).join()" :active="true" :auto-hide="false" :row="1" name="achievement" @close="closed">
    <template v-if="many">
      <strong class="title">{{ current.length }} achievements unlocked!</strong>
      <span class="line">+{{ number(coins) }} coins. See them on the Achievements page.</span>
    </template>
    <template v-else>
      <strong class="title">Achievement unlocked: {{ current[0].name }}</strong>
      <span class="line">{{ current[0].game }}{{ current[0].levels > 1 ? `, level ${current[0].level}` : '' }}: {{ current[0].text }}</span>
      <span class="line reward">+{{ number(current[0].coins) }} coins</span>
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
