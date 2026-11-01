<script setup>
// File: the Profile page's avatar editor. Depends on: ../../shared/avatar.js, ../profileApi.js (updateProfile), ../session.js,
//   ../shopStore.js (owns), AvatarFigure.vue, vue-router (RouterLink).
// Props: none.  Emits: none.  Slots: none.
// Side effects: save() sends the avatar to the server through updateProfile; otherwise only local state.
// The avatar editor on the Profile page: pick one option for each slot (skin, hair, eyes ...) and watch the figure change.
// Options you have not bought are shown but cannot be picked: they are bought in the shop, which previews them on you.
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { AVATAR_SLOTS, avatarItemId, normaliseAvatar } from '../../shared/avatar.js';
import { updateProfile } from '../profileApi.js';
import { session } from '../session.js';
import { owns } from '../shopStore.js';
import AvatarFigure from './AvatarFigure.vue';

// The avatar stored on the account, with any missing or invalid parts filled in.
const saved = computed(() => normaliseAvatar(session.user.avatar));
const draft = ref({ ...saved.value }); // the choices being edited, kept apart from `saved` until Save
// The draft starts again only when the saved avatar itself changes (saved here, or on another device). `saved` is a
// new object every time the account is replaced, which every other profile save does, so watch its parts, not it.
const savedParts = computed(() => AVATAR_SLOTS.map(({ slot }) => saved.value[slot]).join('|'));
watch(savedParts, () => (draft.value = { ...saved.value }));

// True when the draft differs from the saved avatar, which enables the Save and Reset buttons.
const changed = computed(() => AVATAR_SLOTS.some(({ slot }) => draft.value[slot] !== saved.value[slot]));
const message = ref('');
const problem = ref('');
const busy = ref(false);

/**
 * Whether an avatar part has not been bought yet.
 * @param {string} slot
 * @param {{ id: string }} option
 * @returns {boolean}
 * Side effects: none.
 */
const locked = (slot, option) => !owns(avatarItemId(slot, option.id));
// How many avatar options across all slots the player has not bought, for the shop hint.
const lockedCount = computed(() => AVATAR_SLOTS.reduce((n, { slot, options }) => n + options.filter((o) => locked(slot, o)).length, 0));

/**
 * Saves the avatar being edited.
 * @returns {Promise<void>}
 * Side effects: updates the profile; sets message, problem and busy.
 */
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
/**
 * Throws away the unsaved changes.
 * @returns {void}
 * Side effects: resets the draft to the saved avatar.
 */
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
              :title="locked(s.slot, o) ? `${o.name}: buy it in the shop (${o.price} gold)` : o.name"
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
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
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
