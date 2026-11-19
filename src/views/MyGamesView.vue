<script setup>
// The "Your games" page: every game this person has on the go, anywhere on the site, with the way back into each.
// It is a page of its own in the top menu rather than a strip on the home page, because it is what somebody opens
// the site to do — the home page is for starting something new, and this is for carrying something on.
//
// Props: none.  Emits: none.  Slots: none.
// Depends on: vue-i18n and ../components/MyGames.vue, which fetches the list and draws it.
// Side effects: none of its own (MyGames asks the server once when it is put on screen).
import { useI18n } from 'vue-i18n';
import MyGames from '../components/MyGames.vue';

const { t } = useI18n();
</script>

<template>
  <section class="stack">
    <h1>{{ t('games.yours') }}</h1>
    <MyGames />
  </section>
</template>

<style scoped>
h1 {
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
</style>
