<script setup>
// One favour token: a small gold disc.  Add class="spent" for the smaller, faded one shown on a tool card that has been used.
// Props: none.  Emits: none.  Side effects: none.
</script>

<template>
  <i class="token" />
</template>

<style scoped>
.token {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f6d58f, var(--amber) 60%, #9a6a1c);
  border: 1px solid #6d4a10;
}
.token.spent {
  opacity: 0.6;
  width: 0.6rem;
  height: 0.6rem;
}
</style>
