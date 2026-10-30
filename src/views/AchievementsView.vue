<script setup>
// The Achievements page: for the site and then for each game, every achievement with the level you have reached and how far
// you are towards the next. The rules for levels are in shared/achievements.js; the server works out the numbers.
import { onMounted, ref } from 'vue';
import { api, session } from '../session.js';

const sections = ref(null);
const reward = ref(0); // coins for every level unlocked
const failed = ref('');

onMounted(async () => {
  try {
    const data = await api('GET', '/api/achievements');
    sections.value = data.sections;
    reward.value = data.reward;
  } catch (e) {
    failed.value = e.message;
  }
});

const number = (n) => n.toLocaleString('en-GB');
const percent = (progress) => Math.floor(progress * 100);
const done = (a) => a.level === a.maxLevel;
const unlocked = (section) => section.achievements.reduce((sum, a) => sum + a.level, 0);
const possible = (section) => section.achievements.reduce((sum, a) => sum + a.maxLevel, 0);
</script>

<template>
  <section class="stack achievements">
    <h1>Achievements for {{ session.user.displayName }}</h1>
    <p v-if="failed" class="panel" role="alert">{{ failed }}</p>
    <p v-else-if="!sections" class="muted">Loading…</p>

    <template v-else>
    <p v-if="reward" class="muted note">Every level you unlock earns {{ reward.toLocaleString('en-GB') }} coins.</p>
    <section v-for="section in sections" :key="section.id" class="panel stack" :data-section="section.id" :aria-label="`${section.name} achievements`">
      <header class="heading">
        <h2>{{ section.name }}</h2>
        <span class="muted tally">{{ unlocked(section) }} of {{ possible(section) }} levels</span>
      </header>
      <ul class="boxes">
        <li v-for="a in section.achievements" :key="a.id" class="box" :class="{ complete: done(a) }" :data-achievement="a.id">
          <div class="top">
            <h3>{{ a.name }}</h3>
            <span class="level" :title="`${a.level} of ${a.maxLevel} levels`">{{ done(a) ? 'Complete' : a.level ? `Level ${a.level}` : 'Not started' }}</span>
          </div>
          <ol class="pips" aria-hidden="true">
            <li v-for="(l, i) in a.levels" :key="i" :class="{ on: l.done }" />
          </ol>
          <p v-if="a.next" class="goal">Level {{ a.level + 1 }}: {{ a.next.text }}</p>
          <p v-else class="goal">Level {{ a.maxLevel }}: {{ a.current.text }}</p>
          <div class="bar" role="progressbar" :aria-valuenow="percent(a.progress)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${a.name}: progress towards the next level`">
            <i :style="{ width: `${percent(a.progress)}%` }" />
          </div>
          <p class="count muted">
            <template v-if="a.next">{{ number(a.value) }} / {{ number(a.next.n) }}</template>
            <template v-else>{{ number(a.value) }}</template>
          </p>
        </li>
      </ul>
    </section>
    </template>
  </section>
</template>

<style scoped>
.achievements {
  max-width: 960px;
  margin: 0 auto;
}
.achievements > h1 {
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.note {
  margin: 0;
}
.panel {
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
}
.heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}
.tally {
  font-size: 0.9rem;
}
.boxes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 0.8rem;
}
.box {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-raised);
}
.box.complete {
  border-color: var(--amber);
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
}
.top h3 {
  font-size: 1.05rem;
}
.level {
  flex: none;
  font-size: 0.8rem;
  color: var(--muted);
}
.complete .level {
  color: var(--amber);
  font-weight: 650;
}
.pips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.3rem;
}
.pips li {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  border: 1px solid var(--line);
}
.pips li.on {
  background: var(--amber);
  border-color: var(--amber);
}
.goal {
  margin: 0;
  font-size: 0.95rem;
}
.bar {
  height: 0.6rem;
  border-radius: 999px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--amber);
  border-radius: 999px;
}
.count {
  margin: 0;
  font-size: 0.85rem;
  text-align: right;
}
</style>
