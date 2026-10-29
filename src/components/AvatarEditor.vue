<script setup>
// The avatar editor on the Profile page: pick one option for each slot (skin, hair, eyes ...) and watch the figure change.
// Options you have not bought are shown but cannot be picked: they are bought in the shop, which previews them on you.
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { AVATAR_SLOTS, avatarItemId, normaliseAvatar } from '../../shared/avatar.js';
import { owns, session, updateProfile } from '../session.js';
import AvatarFigure from './AvatarFigure.vue';

const saved = computed(() => normaliseAvatar(session.user.avatar));
const draft = ref({ ...saved.value });
watch(saved, (avatar) => (draft.value = { ...avatar }));

const changed = computed(() => AVATAR_SLOTS.some(({ slot }) => draft.value[slot] !== saved.value[slot]));
const message = ref('');
const problem = ref('');
const busy = ref(false);

const locked = (slot, option) => !owns(avatarItemId(slot, option.id));
const lockedCount = computed(() => AVATAR_SLOTS.reduce((n, { slot, options }) => n + options.filter((o) => locked(slot, o)).length, 0));

async function save() {
  message.value = problem.value = '';
  busy.value = true;
  try {
    await updateProfile({ avatar: draft.value });
    message.value = 'Avatar saved.';
  } catch (e) {
    problem.value = e.message;
  } finally {
    busy.value = false;
  }
}
const reset = () => (draft.value = { ...saved.value });
</script>

<template>
  <div class="panel stack avatar-editor">
    <h2>Avatar</h2>
    <p class="muted">Shown to other players when they open your details in a game.<template v-if="lockedCount"> More parts are for sale in the <RouterLink to="/shop">shop</RouterLink>.</template></p>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="problem" class="bad" role="alert">{{ problem }}</p>

    <div class="layout">
      <div class="figure">
        <AvatarFigure :avatar="draft" size="9rem" label="Your avatar" />
        <div class="row">
          <button class="primary" :disabled="!changed || busy" @click="save">Save avatar</button>
          <button :disabled="!changed || busy" @click="reset">Undo</button>
        </div>
      </div>

      <div class="slots">
        <fieldset v-for="s in AVATAR_SLOTS" :key="s.slot" class="slot" :data-slot="s.slot">
          <legend>{{ s.label }}</legend>
          <div class="options">
            <button
              v-for="o in s.options"
              :key="o.id"
              class="option"
              :class="{ chosen: draft[s.slot] === o.id, locked: locked(s.slot, o), colour: o.colour }"
              :style="o.colour ? { '--swatch': o.gradient ? `linear-gradient(${o.gradient.join(', ')})` : o.colour } : undefined"
              :disabled="locked(s.slot, o)"
              :title="locked(s.slot, o) ? `${o.name}: buy it in the shop (${o.price} coins)` : o.name"
              :aria-label="`${s.label}: ${o.name}`"
              :aria-pressed="draft[s.slot] === o.id"
              @click="draft[s.slot] = o.id"
            >
              <template v-if="!o.colour">{{ o.name }}</template>
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: rgb(14 26 32 / 0.88);
}
.ok,
.bad {
  margin: 0;
}
.ok {
  color: var(--moss);
}
.bad {
  color: var(--danger);
}
.layout {
  display: flex;
  gap: 1.2rem;
  align-items: flex-start;
  flex-wrap: wrap;
}
.figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  margin: 0 auto;
}
.slots {
  flex: 1;
  min-width: min(100%, 16rem);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.slot {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
legend {
  padding: 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.option {
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  font-size: 0.9rem;
}
.option.colour {
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  border-radius: 50%;
  background: var(--swatch);
  border: 2px solid var(--line);
}
.option.chosen {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px var(--amber);
}
.option.locked {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
