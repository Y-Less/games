<script setup>
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import AvatarEditor from '../components/AvatarEditor.vue';
import { cardBackCss, changePassword, owns, session, updateProfile, uploadBackground, uploadCardBack } from '../session.js';

const displayName = ref(session.user.displayName);
const current = computed(() => session.user.background);
const message = ref('');
const problem = ref('');

const colour = ref(current.value.type === 'colour' ? current.value.value : '#16252d');
const gradient = ref(
  current.value.type === 'gradient' ? { from: current.value.from, to: current.value.to, angle: current.value.angle } : { from: '#16252d', to: '#7a3e55', angle: 160 },
);
const oldPassword = ref('');
const newPassword = ref('');

async function attempt(task, done) {
  message.value = '';
  problem.value = '';
  try {
    await task();
    message.value = done;
  } catch (e) {
    problem.value = e.message;
  }
}

const saveName = () => attempt(() => updateProfile({ displayName: displayName.value }), 'Name saved.');
const choose = (background) => attempt(() => updateProfile({ background }), 'Background saved.');
const upload = (event) => {
  const file = event.target.files?.[0];
  if (file) attempt(() => uploadBackground(file), 'Background saved.');
  event.target.value = '';
};
const savePassword = () =>
  attempt(async () => {
    await changePassword(oldPassword.value, newPassword.value);
    oldPassword.value = newPassword.value = '';
  }, 'Password changed. Your other devices have been signed out.');

const chooseCardBack = (cardBack) => attempt(() => updateProfile({ cardBack }), 'Card back saved.');
const uploadBack = (event) => {
  const file = event.target.files?.[0];
  if (file) attempt(() => uploadCardBack(file), 'Card back saved.');
  event.target.value = '';
};
const isBackPreset = (key) => session.user.cardBack.type === 'preset' && session.user.cardBack.value === key;
const isPreset = (key) => current.value.type === 'preset' && current.value.value === key;
</script>

<template>
  <section class="stack profile">
    <h1>Profile</h1>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="problem" class="bad" role="alert">{{ problem }}</p>

    <form class="panel stack" @submit.prevent="saveName">
      <h2>Name</h2>
      <p class="muted">Signed in as <strong>{{ session.user.username }}</strong>. Other players see your display name.</p>
      <div class="row">
        <input v-model="displayName" maxlength="20" aria-label="Display name" />
        <button :disabled="!displayName.trim() || displayName.trim() === session.user.displayName">Save</button>
      </div>
    </form>

    <AvatarEditor />

    <div class="panel stack">
      <h2>Background</h2>
      <p class="muted">The picture behind the site. Games stay on a calm panel, so it never gets in the way of play.</p>

      <h3>Presets</h3>
      <div class="swatches">
        <button
          v-for="(css, key) in session.presets"
          :key="key"
          class="swatch"
          :class="{ chosen: isPreset(key), locked: !owns(`bg:${key}`) }"
          :style="{ backgroundImage: css }"
          :title="owns(`bg:${key}`) ? key : `${key}: buy it in the shop`"
          :disabled="!owns(`bg:${key}`)"
          :aria-label="`${key} background`"
          :aria-pressed="isPreset(key)"
          @click="choose({ type: 'preset', value: key })"
        />
      </div>

      <h3>A colour</h3>
      <p v-if="!owns('bg-colour')" class="muted">Unlock this in the <RouterLink to="/shop">shop</RouterLink>.</p>
      <div class="row">
        <input v-model="colour" type="color" class="colour" aria-label="Background colour" :disabled="!owns('bg-colour')" />
        <button :disabled="!owns('bg-colour')" @click="choose({ type: 'colour', value: colour })">Use this colour</button>
      </div>

      <h3>A gradient</h3>
      <p v-if="!owns('bg-gradient')" class="muted">Unlock this in the <RouterLink to="/shop">shop</RouterLink>.</p>
      <div class="row">
        <input v-model="gradient.from" type="color" class="colour" aria-label="Gradient start" :disabled="!owns('bg-gradient')" />
        <input v-model="gradient.to" type="color" class="colour" aria-label="Gradient end" :disabled="!owns('bg-gradient')" />
        <label class="angle">Angle <input v-model.number="gradient.angle" type="range" min="0" max="360" :disabled="!owns('bg-gradient')" /></label>
        <span class="preview" :style="{ backgroundImage: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` }" />
        <button :disabled="!owns('bg-gradient')" @click="choose({ type: 'gradient', ...gradient })">Use this gradient</button>
      </div>

      <h3>Your own picture</h3>
      <p v-if="!owns('bg-upload')" class="muted">Unlock this in the <RouterLink to="/shop">shop</RouterLink>.</p>
      <p v-else class="muted">PNG, JPEG or WebP, up to 3 MB.</p>
      <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload a background picture" :disabled="!owns('bg-upload')" @change="upload" />
    </div>

    <div class="panel stack">
      <h2>Card back</h2>
      <p class="muted">What the face-down cards look like to you in every card game.</p>
      <div class="swatches">
        <button
          v-for="(css, key) in session.cardBacks"
          :key="key"
          class="back"
          :class="{ chosen: isBackPreset(key), locked: !owns(`cb:${key}`) }"
          :style="{ background: css }"
          :title="owns(`cb:${key}`) ? key : `${key}: buy it in the shop`"
          :disabled="!owns(`cb:${key}`)"
          :aria-label="`${key} card back`"
          :aria-pressed="isBackPreset(key)"
          @click="chooseCardBack({ type: 'preset', value: key })"
        />
        <span v-if="session.user.cardBack.type === 'image'" class="back chosen" :style="{ background: cardBackCss(session.user.cardBack) }" title="Your picture" />
      </div>
      <h3>Your own picture</h3>
      <p v-if="!owns('cb-upload')" class="muted">Unlock this in the <RouterLink to="/shop">shop</RouterLink>.</p>
      <p v-else class="muted">PNG, JPEG or WebP, up to 3 MB. Portrait pictures fit best.</p>
      <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload a card back picture" :disabled="!owns('cb-upload')" @change="uploadBack" />
    </div>

    <form class="panel stack" @submit.prevent="savePassword">
      <h2>Password</h2>
      <input v-model="oldPassword" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" />
      <input v-model="newPassword" type="password" autocomplete="new-password" placeholder="New password (at least 8 characters)" aria-label="New password" />
      <button :disabled="!oldPassword || newPassword.length < 8">Change password</button>
    </form>
  </section>
</template>

<style scoped>
.profile {
  max-width: 720px;
  margin: 0 auto;
}
.profile > h1 {
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.panel {
  background: rgb(14 26 32 / 0.88);
}
h3 {
  font-size: 1rem;
  margin-top: 0.4rem;
}
.ok {
  color: var(--moss);
  margin: 0;
  background: rgb(14 26 32 / 0.88);
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
}
.bad {
  color: var(--danger);
  margin: 0;
  background: rgb(14 26 32 / 0.88);
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.swatch {
  width: 4.5rem;
  height: 3rem;
  border-radius: 10px;
  padding: 0;
  background-size: cover;
  border: 2px solid var(--line);
}
.swatch.locked,
.back.locked {
  opacity: 0.4;
  cursor: not-allowed;
}
.swatch.chosen {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px var(--amber);
}
.back {
  width: 3rem;
  height: 4.2rem;
  border-radius: 6px;
  padding: 0;
  border: 3px solid #f4efe3;
  display: inline-block;
}
.back.chosen {
  box-shadow: 0 0 0 3px var(--amber);
}
.colour {
  width: 3.2rem;
  height: 2.4rem;
  padding: 0.1rem;
}
.angle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.angle input {
  width: 8rem;
}
.preview {
  width: 4.5rem;
  height: 2.4rem;
  border-radius: 8px;
  border: 1px solid var(--line);
}
form .row > input:not([type]) {
  width: auto;
  flex: 1;
  min-width: 0;
}
input[type='file'] {
  padding: 0.5rem;
}
</style>
