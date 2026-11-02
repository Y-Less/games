<script setup>
// The look shared by the tool and objective cards: a name, a cost or points line on the right of it, and one line of text
// below.  Attributes given by the parent (class, role, tabindex, title, listeners) land on the card itself.
// Props: heading (the card's name), text (the one line of rules), costTitle (hover title of the cost, optional).
// Slots: cost (what goes in the cost span: tokens, "costs 1", "3 per set"), icon (optional picture at the left, which must be
//   no taller than the two lines of text so the card keeps the same size).
// Emits: none.  Side effects: none.
defineProps({ heading: { type: String, required: true }, text: { type: String, default: '' }, costTitle: { type: String, default: undefined } });
</script>

<template>
  <div class="card">
    <slot name="icon" />
    <div class="body">
    <div class="tool-head">
      <strong>{{ heading }}</strong>
      <span class="cost" :title="costTitle"><slot name="cost" /></span>
    </div>
    <p class="line">{{ text }}</p>
    </div>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.25rem 0.6rem 0.3rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-sunken) 85%, transparent);
  cursor: default;
}
.body {
  flex: 1;
  min-width: 0;
}
.tool-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.9rem;
  white-space: nowrap;
}
.tool-head strong {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cost {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex: none;
  font-size: 0.78rem;
  color: var(--amber);
}
.line {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
