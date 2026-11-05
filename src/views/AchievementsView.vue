<script setup>
// The Achievements page: for the site and then for each game, every achievement with the level you have reached and how far
// you are towards the next.  The rules for levels are in shared/achievements.js; the server works out the numbers.
// Props: none.  Emits: none.  Slots: none.
// Depends on: api.js (GET /api/achievements), session.js, catalogueText.js (the names and texts a language may translate)
// and messageText.js (intlLocale).  Side effects: one request on mount.
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.js';
import { catalogue } from '../catalogueText.js';
import { intlLocale } from '../messageText.js';
import { session } from '../session.js';

/** The section that is the site's own rather than a game's (server/achievements.js). */
const SITE_SECTION = 'global';

const { t } = useI18n();
const sections = ref(null); // the server's sections once loaded (null while loading)
const failed = ref(''); // the error text if loading failed

// Loads the achievements.  Side effects: sets sections, or failed.
onMounted(async () => {
  try {
    const data = await api('GET', '/api/achievements');
    sections.value = data.sections;
  } catch (e) {
    failed.value = e.message;
  }
});

// Returns n in the language's digits and grouping.
const number = (n) => n.toLocaleString(intlLocale());
// Returns progress (0 to 1) as a whole percentage, rounded down.
const percent = (progress) => Math.floor(progress * 100);
// Returns true when achievement `a` is at its top level.
const done = (a) => a.level === a.maxLevel;
// Returns true when `a` has just one level.
const single = (a) => a.maxLevel === 1; // one level: you have it or you do not, so there is nothing to count
// Returns true when `a` keeps its name and goal to itself: a one-off unlock nobody has earned yet, and only that.
// An achievement with levels always shows what it asks for and how far along you are, even before the first level.
const secret = (a) => single(a) && a.level === 0;
// Returns true when nothing at all has been earned yet (the box is drawn dimmed, whether or not it is a secret).
const untouched = (a) => a.level === 0;
// Returns the total of levels earned across a section's achievements.
const unlocked = (section) => section.achievements.reduce((sum, a) => sum + a.level, 0);
// Returns the total of levels available across a section's achievements.
const possible = (section) => section.achievements.reduce((sum, a) => sum + a.maxLevel, 0);
// Returns a section's heading: the site's own words for its section, a game's name for the rest.
const sectionName = (section) => (section.id === SITE_SECTION ? t('achievements.site') : catalogue.gameName(section));
// Returns an achievement's name in the language.
const name = (section, a) => catalogue.achievementName(section.id, a);
// Returns what a level ({ n, text }) of an achievement asks for, in the language.
const goal = (section, a, level) => catalogue.achievementText(section.id, a, level.n, level.text);
// Returns the line under an achievement's name.  One with levels says what its number counts ("Cards played"), because
// the level it has reached and the number it is working towards are already drawn as the badge and the count beside the
// bar; a one-off, which has neither, says what it asks for instead.  The goal is the fallback for a definition that
// names nothing (no label and no labelled stat), so a box is never left with a blank line.
const description = (section, a) =>
  (single(a) ? goal(section, a, a.levels[0]) : catalogue.achievementLabel(section.id, a) ?? goal(section, a, a.next ?? a.current));
// Returns the badge text beside an achievement's name.
function badge(a) {
  if (untouched(a)) return t('achievements.locked');
  if (single(a)) return t('achievements.unlocked');
  if (done(a)) return t('achievements.complete');
  return t('achievements.level', { level: a.level });
}
</script>

<template>
  <section class="stack achievements">
    <h1>{{ t('achievements.title', { name: session.user.displayName }) }}</h1>
    <p v-if="failed" class="panel" role="alert">{{ failed }}</p>
    <p v-else-if="!sections" class="muted">{{ t('common.loading') }}</p>

    <template v-else>
    <section v-for="section in sections" :key="section.id" class="panel stack" :data-section="section.id" :aria-label="t('achievements.sectionLabel', { name: sectionName(section) })">
      <header class="heading">
        <h2>{{ sectionName(section) }}</h2>
        <span class="muted tally">{{ t('achievements.tally', { unlocked: number(unlocked(section)), possible: number(possible(section)) }) }}</span>
      </header>
      <ul class="boxes">
        <li v-for="a in section.achievements" :key="a.id" class="box" :class="{ complete: done(a), locked: untouched(a) }" :data-achievement="a.id">
          <div class="top">
            <h3>{{ secret(a) ? t('achievements.secret') : name(section, a) }}</h3>
            <span class="level" :title="t('achievements.levelsTitle', { level: a.level, max: a.maxLevel })">{{ badge(a) }}</span>
          </div>
          <p v-if="secret(a)" class="goal">{{ t('achievements.secret') }}</p>
          <template v-else>
          <ol v-if="!single(a)" class="pips" aria-hidden="true">
            <li v-for="(l, i) in a.levels" :key="i" :class="{ on: l.done }" />
          </ol>
          <p class="goal">{{ description(section, a) }}</p>
          <div v-if="!single(a)" class="bar" role="progressbar" :aria-valuenow="percent(a.progress)" aria-valuemin="0" aria-valuemax="100" :aria-label="t('achievements.progressLabel', { name: name(section, a) })">
            <i :style="{ width: `${percent(a.progress)}%` }" />
          </div>
          <p v-if="!single(a)" class="count muted">
            <template v-if="a.next">{{ t('achievements.countOf', { value: number(a.value), target: number(a.next.n) }) }}</template>
            <template v-else>{{ number(a.value) }}</template>
          </p>
          </template>
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
  /* The name and its pips belong together, and so do the bar and its count; the description sits between the two pairs,
     so the rows are spaced by hand rather than by one gap for all of them. */
  gap: 0.35rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 14px;
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
  font-size: 1.1rem;
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
  gap: 0.4rem;
}
.pips li {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  border: 1px solid var(--line);
}
.pips li.on {
  background: var(--amber);
  border-color: var(--amber);
}
.goal {
  /* Set off from the pips above it, which belong with the name. */
  margin: 0.45rem 0 0;
  font-size: 1rem;
}
.bar {
  height: 0.7rem;
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
