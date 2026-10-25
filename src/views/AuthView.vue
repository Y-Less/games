<script setup>
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
    <h1>Game Hub</h1>
    <p class="muted">Sign in to play, or make an account. Your statistics and background are saved with it.</p>

    <form class="panel stack" @submit.prevent="submit">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ primary: mode === 'login' }" @click="mode = 'login'">Sign in</button>
        <button type="button" role="tab" :aria-selected="mode === 'register'" :class="{ primary: mode === 'register' }" @click="mode = 'register'">New account</button>
      </div>

      <div>
        <label for="username">Username</label>
        <input id="username" v-model="username" autocomplete="username" maxlength="20" autocapitalize="none" spellcheck="false" autofocus />
      </div>
      <div v-if="mode === 'register'">
        <label for="display">Display name <span class="muted">(shown to other players; you can change it later)</span></label>
        <input id="display" v-model="displayName" maxlength="20" :placeholder="username || 'Same as your username'" autocomplete="nickname" />
      </div>
      <div>
        <label for="password">Password <span v-if="mode === 'register'" class="muted">(at least 8 characters)</span></label>
        <input id="password" v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" />
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="primary" :disabled="busy || !username || !password">{{ mode === 'login' ? 'Sign in' : 'Create account' }}</button>
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
  background: rgb(14 26 32 / 0.88);
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
