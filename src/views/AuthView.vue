<script setup>
// The sign-in and registration page (one form, two modes).
// Props: none. Emits: none. Slots: none.
// Depends on: session.js (signIn, register, safeNext) and vue-router. Side effects: signs in or registers, then navigates to
// the page asked for (`?next=`, checked by safeNext so it cannot leave the site).
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { register, safeNext, signIn } from '../session.js';

const route = useRoute();
const router = useRouter();
const mode = ref('login'); // 'login' | 'register'
const username = ref('');
const password = ref('');
const displayName = ref('');
const error = ref('');
const busy = ref(false);

/**
 * Submits the form: signs in or registers according to the mode, then goes on to the wanted page.
 * @returns {Promise<void>}
 * Side effects: sets busy and error; changes the session; navigates on success. Ignored while already busy.
 */
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (mode.value === 'login') await signIn(username.value, password.value);
    else await register(username.value, password.value, displayName.value);
    const next = safeNext(route.query.next);
    router.push(next);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="auth">
    <h1>{{ $t('nav.brand') }}</h1>
    <p class="muted">{{ $t('auth.intro') }}</p>

    <form class="panel stack" @submit.prevent="submit">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ primary: mode === 'login' }" @click="mode = 'login'">{{ $t('auth.signIn') }}</button>
        <button type="button" role="tab" :aria-selected="mode === 'register'" :class="{ primary: mode === 'register' }" @click="mode = 'register'">{{ $t('auth.newAccount') }}</button>
      </div>

      <div>
        <label for="username">{{ $t('auth.username') }}</label>
        <input id="username" v-model="username" autocomplete="username" maxlength="20" autocapitalize="none" spellcheck="false" autofocus />
      </div>
      <div v-if="mode === 'register'">
        <label for="display">{{ $t('auth.displayName') }} <span class="muted">{{ $t('auth.displayNameHint') }}</span></label>
        <input id="display" v-model="displayName" maxlength="20" :placeholder="username || $t('auth.sameAsUsername')" autocomplete="nickname" />
      </div>
      <div>
        <label for="password">{{ $t('auth.password') }} <span v-if="mode === 'register'" class="muted">{{ $t('auth.passwordHint') }}</span></label>
        <input id="password" v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" />
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="primary" :disabled="busy || !username || !password">{{ mode === 'login' ? $t('auth.signIn') : $t('auth.createAccount') }}</button>
    </form>
  </section>
</template>

<style scoped>
.auth {
  max-width: 420px;
  margin: 8vh auto 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-align: center;
}
h1 {
  font-size: 2.4rem;
  color: var(--amber);
}
form {
  text-align: left;
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
}
.tabs {
  display: flex;
  gap: 0.4rem;
}
.tabs button {
  flex: 1;
}
label {
  display: block;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
}
.error {
  margin: 0;
  color: var(--danger);
}
</style>
