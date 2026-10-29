<script setup>
// A player's name in the style they bought (a small border and background, see shared/nameStyles.js). Give it the
// name to show (and an animation on its border, see shared/animations.js) and, for a real player, their account id as `userId` (games send it as `userId` on their scoreboard
// players): the style is then looked up from the site. Without a userId (a computer player, say) the name is plain.
import { computed } from 'vue';
import { nameLook } from '../nameLook.js';

const props = defineProps({
  name: { type: String, required: true },
  userId: { type: Number, default: null },
  styleId: { type: String, default: null }, // show this style whatever the player owns (the shop's previews)
  animationId: { type: String, default: null }, // and this animation
  as: { type: String, default: 'span' }, // the element to draw: a `button` makes the whole button wear the style (anything after the name goes in the slot)
});

const look = computed(() => nameLook(props));
</script>

<template>
  <component :is="as" class="styled-name name-pill" :class="{ styled: look.styled }" :data-name-style="look.id" :data-animation="look.animation" :style="look.css">{{ name }}<slot /></component>
</template>

<style scoped>
.styled-name.styled {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  padding: 0 0.45em;
  border-width: 1px; /* the colours come from the .name-pill rules in style.css */
  border-style: solid;
  border-radius: 999px;
  line-height: 1.35;
  vertical-align: baseline;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.styled-name[data-animation='rainbow'] {
  border-width: 2px;
}
</style>
