<script setup>
// A small robot-head glyph marking a computer player, the same size wherever it appears (it takes `size` px square, or
// 1em by default), so a row never changes width because one seat is a computer. It is an image with the label
// "Computer player" (override with `label`).
defineProps({
  size: { type: [Number, String], default: null },
  label: { type: String, default: 'Computer player' },
});
</script>

<template>
  <span class="bot-icon" role="img" :aria-label="label" :title="label" :style="size ? { width: `${size}px`, height: `${size}px` } : undefined">
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 1.6v2" />
        <rect x="2.6" y="4" width="10.8" height="8.4" rx="2" />
        <path d="M1 7.6v2M15 7.6v2" />
      </g>
      <circle cx="5.9" cy="8.1" r="1.1" fill="currentColor" />
      <circle cx="10.1" cy="8.1" r="1.1" fill="currentColor" />
      <path d="M5.8 10.6h4.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  </span>
</template>

<style scoped>
.bot-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: none;
  vertical-align: -0.12em;
}
.bot-icon svg {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
