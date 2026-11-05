<script setup>
// File: a panel whose body folds away behind its heading, for the pages that list a section per game (Statistics and
//   Achievements, which otherwise open as a wall of every game at once).  Depends on: Vue only.
// Props: title (String, the heading), open (Boolean, whether it starts open; false, so a page of them opens tidy).
// Emits: none.
// Slots: summary (beside the heading, shown open or shut: the one line worth seeing without opening it), default (the body).
// Side effects: none; it keeps its own open or shut state, and forgets it when the page is left.
//
// The heading is a button inside the `h2` rather than around it: the heading stays a heading for anything that
// navigates a page by them, and the button carries `aria-expanded` so that its state is read out.  The arrow is drawn
// in CSS so that the heading reads as the game's name and nothing else.
//
// The body is hidden rather than dropped (`v-show`), so opening a panel shows what is already there instead of
// building it again, and anything a test or a find-in-page looks for is still in the page.
import { ref, useId } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  open: { type: Boolean, default: false },
});

const shown = ref(props.open);
const bodyId = useId();
</script>

<template>
  <section class="panel stack collapsible" :class="{ shut: !shown }">
    <header class="heading">
      <h2>
        <button type="button" class="fold" :aria-expanded="shown" :aria-controls="bodyId" @click="shown = !shown">{{ title }}</button>
      </h2>
      <slot name="summary" />
    </header>
    <div :id="bodyId" v-show="shown" class="stack body"><slot /></div>
  </section>
</template>

<style scoped>
.heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}
h2 {
  margin: 0;
  min-width: 0;
}
.fold {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}
/* The arrow is decorative: aria-expanded is what says whether the panel is open. */
.fold::before {
  content: '▸';
  flex: none;
  font-size: 0.8em;
  color: var(--amber);
  transition: transform 150ms ease;
}
.collapsible:not(.shut) .fold::before {
  transform: rotate(90deg);
}
/* The heading is a button, so the site's own button styling has to be kept off it in every state. */
.fold:hover,
.fold:focus,
.fold:focus-visible {
  color: var(--amber);
  background: none;
  border: 0;
  box-shadow: none;
}
.fold:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 3px;
  border-radius: 4px;
}
@media (prefers-reduced-motion: reduce) {
  .fold::before {
    transition: none;
  }
}
</style>
