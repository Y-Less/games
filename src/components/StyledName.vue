<script setup>
// A player's name in the style they bought (a small border and background, see shared/nameStyles.js). Give it the
// name to show and, for a real player, their account id as `userId` (games send it as `userId` on their scoreboard
// players): the style is then looked up from the site. Without a userId (a computer player, say) the name is plain.
import { computed } from 'vue';
import { nameStyleById } from '../../shared/nameStyles.js';
import { profileOf } from '../profiles.js';

const props = defineProps({
  name: { type: String, required: true },
  userId: { type: Number, default: null },
  styleId: { type: String, default: null }, // show this style whatever the player owns (the shop's previews)
});

const style = computed(() => nameStyleById(props.styleId ?? profileOf(props.userId)?.nameStyle?.style));
const styled = computed(() => style.value.id !== 'plain');
const css = computed(() =>
  styled.value ? { '--ns-border': style.value.border, '--ns-fill': style.value.fill, ...(style.value.text ? { '--ns-text': style.value.text } : {}) } : undefined,
);
</script>

<template>
  <span class="styled-name" :class="{ styled }" :data-name-style="style.id" :style="css">{{ name }}</span>
</template>

<style scoped>
.styled-name.styled {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  padding: 0 0.45em;
  border: 1px solid var(--ns-border);
  border-radius: 999px;
  background: var(--ns-fill);
  color: var(--ns-text, inherit);
  line-height: 1.35;
  vertical-align: baseline;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
