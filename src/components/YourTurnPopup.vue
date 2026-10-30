<script setup>
// The "It's your turn" pop-up: a NoticePopup with a short message. It appears the moment `active` becomes true (or when it
// is already true as the component first appears, such as after coming back to a game), and goes away by itself after
// `duration` milliseconds, or at once when the player clicks OK, or when `active` goes false again (they have acted, or
// the turn moved on). GameStatus draws one for every game from its `mine` flag (see there); use this directly for anything else.
import NoticePopup from './NoticePopup.vue';

defineProps({
  active: { type: Boolean, default: false },
  message: { type: String, default: "It's your turn" },
  duration: { type: Number, default: 3000 }, // milliseconds before it closes itself
});
</script>

<template>
  <NoticePopup :active="active" :duration="duration" name="your-turn"><span class="message">{{ message }}</span></NoticePopup>
</template>
