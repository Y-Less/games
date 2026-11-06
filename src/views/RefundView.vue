<script setup>
// The refund page: where somebody who has bought the shop's "Refunds" unlock writes to customer support about an item
// they would like their Gilders back for.  The writing has to be no fewer than a thousand words, which is counted here
// as you type and again on the server, and what is sent is filed in the database.  Nothing is paid back.
// Props: none.  Emits: none.  Slots: none.
// Depends on: api.js (POST /api/refunds), shopStore.js (whether Refunds has been bought), session.js and
// shared/refunds.js (the word count and the minimum, shared with the server so the two cannot disagree).
// Side effects: refreshes the shop on mount; submitting writes a refund request on the server.
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { REFUND_ITEM, REFUND_MINIMUM_WORDS, countWords } from '../../shared/refunds.js';
import { api } from '../api.js';
import { session } from '../session.js';
import { owns, refreshShop } from '../shopStore.js';

const text = ref('');
const problem = ref(''); // the last refusal, in words
const sending = ref(false);
const sent = ref(false);

// The listing says what has been bought; until it has arrived nothing on this page is decided.
refreshShop();
// Whether this account may use the page at all (false while the listing is still on its way).
const allowed = computed(() => Boolean(session.shop) && owns(REFUND_ITEM));
// How many words have been written so far.
const words = computed(() => countWords(text.value));
// Whether it is long enough to send.
const longEnough = computed(() => words.value >= REFUND_MINIMUM_WORDS);

/**
 * Sends the request to customer support.
 * @returns {Promise<void>}
 * Side effects: one request, which files the refund request; sets sent, sending and problem.
 */
async function submit() {
  problem.value = '';
  sending.value = true;
  try {
    await api('POST', '/api/refunds', { text: text.value });
    sent.value = true;
    text.value = '';
  } catch (error) {
    problem.value = error.message;
  } finally {
    sending.value = false;
  }
}

/**
 * Clears the thank-you so that another request can be written.
 * @returns {void}
 * Side effects: sets sent.
 */
const again = () => {
  sent.value = false;
};
</script>

<template>
  <section class="stack refund">
    <h1>{{ $t('refund.title') }}</h1>

    <template v-if="allowed">
      <p class="panel intro">{{ $t('refund.intro', { min: REFUND_MINIMUM_WORDS }) }}</p>
      <p v-if="problem" class="bad" role="alert">{{ problem }}</p>

      <div v-if="sent" class="panel stack done" role="status">
        <p>{{ $t('refund.sent') }}</p>
        <div class="row">
          <button type="button" @click="again">{{ $t('refund.again') }}</button>
          <RouterLink to="/shop/unlocks">{{ $t('refund.toShop') }}</RouterLink>
        </div>
      </div>

      <form v-else class="panel stack" @submit.prevent="submit">
        <label class="stack">
          {{ $t('refund.label') }}
          <textarea v-model="text" rows="18" :aria-label="$t('refund.label')" :aria-describedby="'refund-count'" />
        </label>
        <p id="refund-count" class="count" :class="{ enough: longEnough }" aria-live="polite">
          {{ longEnough ? $t('refund.enough', { n: words }) : $t('refund.counted', { n: words, min: REFUND_MINIMUM_WORDS }) }}
        </p>
        <div class="row">
          <button type="submit" class="primary" :disabled="!longEnough || sending">{{ sending ? $t('refund.sending') : $t('refund.send') }}</button>
          <RouterLink to="/shop/unlocks">{{ $t('refund.toShop') }}</RouterLink>
        </div>
      </form>
    </template>

    <div v-else-if="session.shop" class="panel stack">
      <p>{{ $t('refund.locked') }}</p>
      <RouterLink to="/shop/unlocks">{{ $t('refund.toShop') }}</RouterLink>
    </div>
    <p v-else class="panel">{{ $t('common.loading') }}</p>
  </section>
</template>

<style scoped>
.refund {
  max-width: 820px;
  margin: 0 auto;
}
h1 {
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.intro {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.5;
}
textarea {
  width: 100%;
  min-height: 24rem;
  resize: vertical;
  font: inherit;
  line-height: 1.5;
}
.count {
  margin: 0;
  color: var(--muted);
}
.count.enough {
  color: var(--amber);
}
.bad {
  margin: 0;
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
  color: var(--danger);
}
.done p {
  margin: 0;
}
</style>
