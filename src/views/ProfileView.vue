<script setup>
// The profile page: display name, animation setting, language, background, card back, marker colour, avatar, and password.
// Props: none.  Emits: none.  Slots: none.
// Depends on: profileApi.js (saving), session.js (the signed-in user), shopStore.js (owns: which unlocks you have),
// appearance.js, i18n.js (the languages on offer), messageText.js (intlLocale), shared/markerColours.js, and AvatarEditor.vue.
// Side effects: every change is saved to the server at once and the session's user (and the page's look and language) is
// replaced by the reply.
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import AvatarEditor from '../components/AvatarEditor.vue';
import { MARKER_COLOURS, CUSTOM_MARKER_ITEM } from '../../shared/markerColours.js';
import { cardBackCss } from '../appearance.js';
import { LANGUAGES, languageName } from '../i18n.js';
import { intlLocale } from '../messageText.js';
import { changePassword, updateProfile, uploadBackground, uploadCardBack } from '../profileApi.js';
import { session } from '../session.js';
import { owns } from '../shopStore.js';

const displayName = ref(session.user.displayName); // the name box's text
// The saved background setting.
const current = computed(() => session.user.background);
// The last success message and the last error message.  The success message is a key (translated when shown, so it
// follows a change of language); the error is the server's reason, already in words.
const message = ref('');
const problem = ref('');

// The custom colour and gradient pickers start from the saved values when they are of that type.
const colour = ref(current.value.type === 'colour' ? current.value.value : '#16252d');
const gradient = ref(
  current.value.type === 'gradient' ? { from: current.value.from, to: current.value.to, angle: current.value.angle } : { from: '#16252d', to: '#7a3e55', angle: 160 },
);
const oldPassword = ref('');
const newPassword = ref('');

/**
 * Runs a save and reports how it went.
 * @param {() => Promise<*>} task  the save to run
 * @param {string} done  the key of the message to show on success
 * @returns {Promise<void>}
 * Side effects: clears then sets message or problem (the server's reason on failure); runs the task.
 */
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

// Each handler below returns the promise from attempt(); all save to the server.
// Saves the display name.
const saveName = () => attempt(() => updateProfile({ displayName: displayName.value }), 'profile.nameSaved');
// 'on', 'off' or 'auto' for the animations radio group (a null setting follows the device).
const animationsChoice = computed(() => (session.user.playAnimations === true ? 'on' : session.user.playAnimations === false ? 'off' : 'auto'));
// What to say once each animations choice ('on' | 'off' | 'auto') is saved.
const ANIMATIONS_SAVED = { on: 'profile.animationsOn', off: 'profile.animationsOff', auto: 'profile.animationsAuto' };
// Saves the animations choice ('on' | 'off' | 'auto').
const setAnimations = (value) => attempt(() => updateProfile({ playAnimations: value === 'on' ? true : value === 'off' ? false : null }), ANIMATIONS_SAVED[value]);
// Saves a numeric setting named `key` (e.g. animation strength) from a slider's input event.
const setLevel = (key, event) => attempt(() => updateProfile({ [key]: Number(event.target.value) }), 'profile.saved');
// A whole-number percentage setting (100 for "normal") as the language writes a percentage.
const percent = (level) => new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(level / 100);
// The saved language choice for the select: a tag, or '' to follow the browser.
const languageChoice = computed(() => session.user.language ?? '');
// Saves the language ('' follows the browser).  The page changes language as soon as the reply arrives (setUser applies it).
const setLanguage = (code) => attempt(() => updateProfile({ language: code || null }), 'profile.languageSaved');
// Saves a background setting object.
const choose = (background) => attempt(() => updateProfile({ background }), 'profile.backgroundSaved');
// Uploads the picked file as the background, then clears the file input so the same file can be picked again.
const upload = (event) => {
  const file = event.target.files?.[0];
  if (file) attempt(() => uploadBackground(file), 'profile.backgroundSaved');
  event.target.value = '';
};
// Changes the password, and empties the two boxes on success.
const savePassword = () =>
  attempt(async () => {
    await changePassword(oldPassword.value, newPassword.value);
    oldPassword.value = newPassword.value = '';
  }, 'profile.passwordChanged');

// Saves a card-back setting object.
const chooseCardBack = (cardBack) => attempt(() => updateProfile({ cardBack }), 'profile.cardBackSaved');
// Uploads the picked file as the card back (like upload, for the card back).
const uploadBack = (event) => {
  const file = event.target.files?.[0];
  if (file) attempt(() => uploadCardBack(file), 'profile.cardBackSaved');
  event.target.value = '';
};
// The custom marker colour picker's value (starts at the saved one, else pink).
const marker = ref(session.user.markerColour ?? '#ff2d95');
// Saves a marker colour (null clears the default).
const chooseMarker = (markerColour) => attempt(() => updateProfile({ markerColour }), markerColour ? 'profile.markerSaved' : 'profile.markerCleared');
// Returns true when colour `c` is the saved marker colour.
const isMarker = (c) => session.user.markerColour === c;
// Returns true when preset card back `key` is the saved one.
const isBackPreset = (key) => session.user.cardBack.type === 'preset' && session.user.cardBack.value === key;
// Returns true when preset background `key` is the saved one.
const isPreset = (key) => current.value.type === 'preset' && current.value.value === key;
</script>

<template>
  <section class="stack profile">
    <h1>{{ $t('profile.title') }}</h1>
    <p v-if="message" class="ok" role="status">{{ $t(message) }}</p>
    <p v-if="problem" class="bad" role="alert">{{ problem }}</p>

    <form class="panel stack" @submit.prevent="saveName">
      <h2>{{ $t('profile.name') }}</h2>
      <i18n-t keypath="profile.signedInAs" tag="p" class="muted">
        <template #name><strong>{{ session.user.username }}</strong></template>
      </i18n-t>
      <div class="row">
        <input v-model="displayName" maxlength="20" :aria-label="$t('profile.displayName')" />
        <button :disabled="!displayName.trim() || displayName.trim() === session.user.displayName">{{ $t('common.save') }}</button>
      </div>
    </form>

    <div class="panel stack">
      <h2>{{ $t('profile.animations') }}</h2>
      <p class="muted">{{ $t('profile.animationsIntro') }}</p>
      <label class="choice">
        {{ $t('profile.playAnimations') }}
        <select :value="animationsChoice" :aria-label="$t('profile.playAnimations')" @change="setAnimations($event.target.value)">
          <option value="auto">{{ $t('profile.followDevice') }}</option>
          <option value="on">{{ $t('profile.alwaysPlay') }}</option>
          <option value="off">{{ $t('profile.neverPlay') }}</option>
        </select>
      </label>
    </div>

    <div class="panel stack">
      <h2>{{ $t('profile.backgroundAnimation') }}</h2>
      <p class="muted">{{ $t('profile.backgroundAnimationIntro') }}</p>
      <label class="angle">
        {{ $t('profile.intensity') }} <span class="muted">{{ percent(session.user.effectIntensity) }}</span>
        <input type="range" min="10" max="300" step="5" :value="session.user.effectIntensity" :aria-label="$t('profile.intensityLabel')" :disabled="!owns('fx-intensity')" @change="setLevel('effectIntensity', $event)" />
      </label>
      <label class="angle">
        {{ $t('profile.speed') }} <span class="muted">{{ percent(session.user.effectSpeed) }}</span>
        <input type="range" min="25" max="300" step="5" :value="session.user.effectSpeed" :aria-label="$t('profile.speedLabel')" :disabled="!owns('fx-speed')" @change="setLevel('effectSpeed', $event)" />
      </label>
    </div>

    <div class="panel stack">
      <h2>{{ $t('profile.language') }}</h2>
      <p class="muted">{{ $t('profile.languageIntro') }}</p>
      <label class="choice">
        {{ $t('profile.language') }}
        <select :value="languageChoice" :aria-label="$t('profile.language')" @change="setLanguage($event.target.value)">
          <option value="">{{ $t('profile.followBrowser') }}</option>
          <option v-for="code in LANGUAGES" :key="code" :value="code" :lang="code">{{ languageName(code) }}</option>
        </select>
      </label>
    </div>

    <AvatarEditor />

    <div class="panel stack">
      <h2>{{ $t('profile.background') }}</h2>
      <p class="muted">{{ $t('profile.backgroundIntro') }}</p>

      <h3>{{ $t('profile.presets') }}</h3>
      <div class="swatches">
        <button
          v-for="(css, key) in session.presets"
          :key="key"
          class="swatch"
          :class="{ chosen: isPreset(key), locked: !owns(`bg:${key}`) }"
          :style="{ backgroundImage: css }"
          :title="owns(`bg:${key}`) ? key : $t('profile.buyInShop', { name: key })"
          :disabled="!owns(`bg:${key}`)"
          :aria-label="$t('profile.presetBackground', { name: key })"
          :aria-pressed="isPreset(key)"
          @click="choose({ type: 'preset', value: key })"
        />
      </div>

      <h3>{{ $t('profile.aColour') }}</h3>
      <i18n-t v-if="!owns('bg-colour')" keypath="profile.unlockInShop" tag="p" class="muted">
        <template #shop><RouterLink to="/shop">{{ $t('profile.shop') }}</RouterLink></template>
      </i18n-t>
      <div class="row">
        <input v-model="colour" type="color" class="colour" :aria-label="$t('profile.backgroundColour')" :disabled="!owns('bg-colour')" />
        <button :disabled="!owns('bg-colour')" @click="choose({ type: 'colour', value: colour })">{{ $t('profile.useThisColour') }}</button>
      </div>

      <h3>{{ $t('profile.aGradient') }}</h3>
      <i18n-t v-if="!owns('bg-gradient')" keypath="profile.unlockInShop" tag="p" class="muted">
        <template #shop><RouterLink to="/shop">{{ $t('profile.shop') }}</RouterLink></template>
      </i18n-t>
      <div class="row">
        <input v-model="gradient.from" type="color" class="colour" :aria-label="$t('profile.gradientStart')" :disabled="!owns('bg-gradient')" />
        <input v-model="gradient.to" type="color" class="colour" :aria-label="$t('profile.gradientEnd')" :disabled="!owns('bg-gradient')" />
        <label class="angle">{{ $t('profile.angle') }} <input v-model.number="gradient.angle" type="range" :aria-label="$t('profile.gradientAngle')" min="0" max="360" :disabled="!owns('bg-gradient')" /></label>
        <span class="preview" :style="{ backgroundImage: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` }" />
        <button :disabled="!owns('bg-gradient')" @click="choose({ type: 'gradient', ...gradient })">{{ $t('profile.useThisGradient') }}</button>
      </div>

      <h3>{{ $t('profile.yourOwnPicture') }}</h3>
      <i18n-t v-if="!owns('bg-upload')" keypath="profile.unlockInShop" tag="p" class="muted">
        <template #shop><RouterLink to="/shop">{{ $t('profile.shop') }}</RouterLink></template>
      </i18n-t>
      <p v-else class="muted">{{ $t('profile.pictureRules') }}</p>
      <input type="file" accept="image/png,image/jpeg,image/webp" :aria-label="$t('profile.uploadBackground')" :disabled="!owns('bg-upload')" @change="upload" />
    </div>

    <div class="panel stack">
      <h2>{{ $t('profile.cardBack') }}</h2>
      <p class="muted">{{ $t('profile.cardBackIntro') }}</p>
      <div class="swatches">
        <button
          v-for="(css, key) in session.cardBacks"
          :key="key"
          class="back"
          :class="{ chosen: isBackPreset(key), locked: !owns(`cb:${key}`) }"
          :style="{ background: css }"
          :title="owns(`cb:${key}`) ? key : $t('profile.buyInShop', { name: key })"
          :disabled="!owns(`cb:${key}`)"
          :aria-label="$t('profile.presetCardBack', { name: key })"
          :aria-pressed="isBackPreset(key)"
          @click="chooseCardBack({ type: 'preset', value: key })"
        />
        <span v-if="session.user.cardBack.type === 'image'" class="back chosen" :style="{ background: cardBackCss(session.user.cardBack) }" :title="$t('profile.yourPicture')" />
      </div>
      <h3>{{ $t('profile.yourOwnPicture') }}</h3>
      <i18n-t v-if="!owns('cb-upload')" keypath="profile.unlockInShop" tag="p" class="muted">
        <template #shop><RouterLink to="/shop">{{ $t('profile.shop') }}</RouterLink></template>
      </i18n-t>
      <p v-else class="muted">{{ $t('profile.cardBackPictureRules') }}</p>
      <input type="file" accept="image/png,image/jpeg,image/webp" :aria-label="$t('profile.uploadCardBack')" :disabled="!owns('cb-upload')" @change="uploadBack" />
    </div>

    <div class="panel stack">
      <h2>{{ $t('profile.markerColour') }}</h2>
      <p class="muted">{{ $t('profile.markerIntro') }}</p>
      <div class="swatches">
        <button
          v-for="c in MARKER_COLOURS"
          :key="c"
          class="dot"
          :class="{ chosen: isMarker(c) }"
          :style="{ background: c }"
          :title="c"
          :aria-label="$t('profile.markerSwatch', { colour: c })"
          :aria-pressed="isMarker(c)"
          @click="chooseMarker(c)"
        />
        <span v-if="session.user.markerColour && !MARKER_COLOURS.includes(session.user.markerColour)" class="dot chosen" :style="{ background: session.user.markerColour }" :title="$t('profile.yourOwnColour')" />
      </div>
      <h3>{{ $t('profile.anyColour') }}</h3>
      <i18n-t v-if="!owns(CUSTOM_MARKER_ITEM)" keypath="profile.unlockInShop" tag="p" class="muted">
        <template #shop><RouterLink to="/shop">{{ $t('profile.shop') }}</RouterLink></template>
      </i18n-t>
      <div class="row">
        <input v-model="marker" type="color" class="colour" :aria-label="$t('profile.markerColour')" :disabled="!owns(CUSTOM_MARKER_ITEM)" />
        <button :disabled="!owns(CUSTOM_MARKER_ITEM)" @click="chooseMarker(marker)">{{ $t('profile.useThisColour') }}</button>
        <button class="quiet" :disabled="!session.user.markerColour" @click="chooseMarker(null)">{{ $t('profile.noDefault') }}</button>
      </div>
    </div>

    <form class="panel stack" @submit.prevent="savePassword">
      <h2>{{ $t('profile.password') }}</h2>
      <input v-model="oldPassword" type="password" autocomplete="current-password" :placeholder="$t('profile.currentPassword')" :aria-label="$t('profile.currentPassword')" />
      <input v-model="newPassword" type="password" autocomplete="new-password" :placeholder="$t('profile.newPasswordPlaceholder')" :aria-label="$t('profile.newPassword')" />
      <button :disabled="!oldPassword || newPassword.length < 8">{{ $t('profile.changePassword') }}</button>
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
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
}
h3 {
  font-size: 1rem;
  margin-top: 0.4rem;
}
.ok {
  color: var(--moss);
  margin: 0;
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
}
.bad {
  color: var(--danger);
  margin: 0;
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
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
.dot {
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--line);
}
.dot.chosen {
  outline: 3px solid var(--amber);
  outline-offset: 2px;
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
.choice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.choice select {
  width: auto;
  max-width: 100%;
}
input[type='file'] {
  padding: 0.5rem;
}
</style>
