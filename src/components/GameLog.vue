<script setup>
// A list of what has happened in a game (scoring, recent actions...) that never changes the size of the page. The box
// has a fixed height (--log-height, 9rem unless the parent says otherwise, or the parent can make it a flex child with
// `flex: 1 1 0`), scrolls inside itself, and keeps the newest entry in view unless the player has scrolled away from it.
//
// `entries` are in the order they happened (oldest first). With `newest-first` the newest is shown at the top instead.
// The default slot draws one entry: <GameLog :entries="log" v-slot="{ entry, index, old }">...</GameLog>.
import { nextTick, onMounted, ref, watch, computed } from 'vue';

const props = defineProps({
  entries: { type: Array, default: () => [] },
  newestFirst: { type: Boolean, default: false },
  label: { type: String, default: 'Recent actions' },
  empty: { type: String, default: '' },
  // How many of the newest entries are drawn at full strength; the rest get the `old` class (0 means none are old).
  fresh: { type: Number, default: 0 },
});

const box = ref(null);
let pinned = true; // true while the newest entry is in view, so that new ones may scroll themselves into view
const SLACK = 6;

const shown = computed(() => {
  const total = props.entries.length;
  const rows = props.entries.map((entry, index) => ({ entry, index, old: props.fresh > 0 && total - index > props.fresh }));
  return props.newestFirst ? rows.reverse() : rows;
});

function toNewest() {
  const el = box.value;
  if (el) el.scrollTop = props.newestFirst ? 0 : el.scrollHeight;
}
function onScroll() {
  const el = box.value;
  if (!el) return;
  pinned = props.newestFirst ? el.scrollTop <= SLACK : el.scrollHeight - el.clientHeight - el.scrollTop <= SLACK;
}

watch(
  () => props.entries.length,
  async () => {
    const was = pinned;
    await nextTick();
    if (was) toNewest();
  },
);
onMounted(toNewest);
defineExpose({ toNewest });
</script>

<template>
  <ul ref="box" class="game-log" :aria-label="label" @scroll.passive="onScroll">
    <li v-if="!entries.length && empty" class="muted">{{ empty }}</li>
    <li v-for="row in shown" :key="row.index" :class="{ old: row.old }">
      <slot :entry="row.entry" :index="row.index" :old="row.old">{{ row.entry?.text ?? row.entry }}</slot>
    </li>
  </ul>
</template>

<style scoped>
.game-log {
  list-style: none;
  margin: 0;
  padding: 0;
  height: var(--log-height, 9rem);
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.game-log > li {
  flex: none;
}
.game-log > li.old {
  color: var(--muted);
}
</style>
