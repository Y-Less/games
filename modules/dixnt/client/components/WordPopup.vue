<script setup>
// When the chooser locks in the word, it pops up large for everyone at the same moment (the shared
// src/components/WordPopup.vue), and the person who is not told the word sees ??? instead, so that they learn a word
// was chosen when the others do.
//
// Props: none.  Emits: none.  Slots: none.
// Side effects: none of its own; the shared pop-up watches what it is given and hides itself after a few seconds.
import { computed } from 'vue';
import WordPopup from '../../../../src/components/WordPopup.vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';

const { t } = useGameText();
const { store } = useDixnt();

// The store's pop-up ({ word, hidden, at }) in the words this viewer reads, or null.
const popup = computed(() => {
  const announced = store.wordPopup;
  if (!announced) return null;
  const hidden = Boolean(announced.hidden);
  return { label: t(hidden ? 'table.wordChosenHidden' : 'table.wordIs'), word: hidden ? t('table.hiddenWord') : announced.word, dark: hidden, at: announced.at };
});
</script>

<template>
  <WordPopup :popup="popup" />
</template>
