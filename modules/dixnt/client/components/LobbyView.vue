<script setup>
// Dixnt lobby: the invite code, the shared players panel (the host can remove people and add computer players), and
// the host's settings: play style, whether anybody chooses the word, card categories, hand size, and how many rounds
// the game runs for.  Everyone else sees them
// read-only.  Every word comes from a locale file (the game's own first, then the site's); a category's label may be
// a message the server sent, so it is drawn with text().
//
// Props: none.  Emits: none.  Slots: none.
// Side effects: sends addBot, fillBots, removeBot, kick, settings and start requests (through the store).
import { computed } from 'vue';
import InviteCode from '../../../../src/components/InviteCode.vue';
import PlayerListPanel from '../../../../src/components/PlayerListPanel.vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';

const { t, text } = useGameText();
const { isHost, players, send, store } = useDixnt();
// The current state.
const state = computed(() => store.state);
// How many more players are needed before the game can start (0 when enough).
const missingPlayers = computed(() => Math.max(0, state.value.minPlayers - players.value.length));
// Cards needed to deal everyone a full hand.
const cardsNeeded = computed(() => players.value.length * state.value.handSize);
// True when the chosen categories hold enough cards for that deal.
const enoughCards = computed(() => state.value.availableCards >= cardsNeeded.value);
// The categories currently in the deck.
const selected = computed(() => state.value.categories.filter((c) => c.selected));
// The names of the chosen categories, as the language joins a list.
const selectedNames = computed(() => selected.value.map((c) => text(c.label)).join(', '));

// The play styles with their titles and rule text (which quotes the current point values), the two the whole table
// votes on first and then the two the word-chooser decides alone.  A style with `needs` is one of the latter: the
// player who decides IS the word-chooser, so it cannot be played with nobody choosing the word, and while that is
// ticked the style says why instead of how it is scored, and cannot be picked.
const judgingOptions = computed(() => {
  const styles = [
    { mode: 'everyone', title: t('judging.everyone.title'), text: t('judging.everyone.text', { perVote: state.value.pointsPerVote }) },
    { mode: 'best', title: t('judging.best.title'), text: t('judging.best.text', { perBest: state.value.pointsPerBest }) },
    {
      mode: 'chooser',
      title: t('judging.chooser.title'),
      text: t('judging.chooser.text', { correct: state.value.pointsChooserCorrect, fooled: state.value.pointsFooledChooser }),
      needs: t('judging.chooser.needsChooser'),
    },
    { mode: 'favourite', title: t('judging.favourite.title'), text: t('judging.favourite.text', { points: state.value.pointsFavourite }), needs: t('judging.favourite.needsChooser') },
  ];
  const off = state.value.noChooser;
  return styles.map((o) => ({ ...o, text: off && o.needs ? o.needs : o.text, off: Boolean(off && o.needs) }));
});
// The option for the style in use (shown to non-hosts).
const currentJudging = computed(() => judgingOptions.value.find((o) => o.mode === state.value.judging));
// Turning the chooser off is out of reach while a style that needs one is picked, as those styles are while it is
// off: the server refuses the pair either way round, and a tick box that sprang back would say nothing about why.
const noChooserOff = computed(() => Boolean(judgingOptions.value.find((o) => o.mode === state.value.judging)?.needs));
// How long the game runs, in words: with a chooser it is counted in everybody's goes at the word, without one in rounds.
const lengthWords = computed(() => ({
  times: t('lobby.times', { count: state.value.rounds }, state.value.rounds),
  rounds: t('lobby.roundCount', { count: state.value.rounds }, state.value.rounds),
  turns: t('lobby.turns', { count: players.value.length * state.value.rounds }, players.value.length * state.value.rounds),
  players: t('lobby.playerCount', { count: players.value.length }, players.value.length),
}));

/**
 * Adds a category to the deck, or removes it if it is already in, by sending the whole new selection.
 * @param {string} key  The category's key.
 * @returns {void}
 * Side effects: sends a `settings` request.
 */
function toggleCategory(key) {
  const categories = state.value.categories.filter((c) => (c.key === key ? !c.selected : c.selected)).map((c) => c.key);
  send('settings', { categories });
}
</script>

<template>
  <section class="panel stack">
    <h2>{{ $t('lobby.title') }}</h2>
    <p class="muted">{{ t('lobby.share', { min: state.minPlayers }) }}</p>
    <div class="row"><InviteCode :code="state.code" /></div>
  </section>

  <PlayerListPanel
    :players="players"
    :you="state.you"
    :host-id="state.hostId"
    :is-host="isHost"
    :min="state.minPlayers"
    :max="state.maxPlayers"
    :size="state.size"
    @size="(n) => send('settings', { size: n })"
    @add-bot="send('addBot')"
    @remove-bot="(slot) => send('removeBot', { slot })"
    @kick="(slot) => send('kick', { slot })"
    @fill-bots="(count) => send('fillBots', { count })"
  />

  <section class="panel stack">
    <h2>{{ t('lobby.playStyle') }}</h2>
    <template v-if="isHost">
      <div class="options" role="radiogroup" :aria-label="t('lobby.playStyle')">
        <label v-for="option in judgingOptions" :key="option.mode" class="option" :class="{ on: state.judging === option.mode, off: option.off }">
          <input
            type="radio"
            name="judging"
            :value="option.mode"
            :checked="state.judging === option.mode"
            :disabled="option.off"
            @change="send('settings', { judging: option.mode })"
          />
          <span>
            <strong>{{ option.title }}</strong>
            <span class="muted">{{ option.text }}</span>
          </span>
        </label>
      </div>
      <label class="option" :class="{ on: state.noChooser, off: noChooserOff }">
        <input
          type="checkbox"
          :checked="state.noChooser"
          :disabled="noChooserOff"
          @change="send('settings', { noChooser: $event.target.checked })"
        />
        <span>
          <strong>{{ t('lobby.noChooser') }}</strong>
          <span class="muted">{{ noChooserOff ? t('judging.needsChooser') : t('lobby.noChooserText') }}</span>
        </span>
      </label>
    </template>
    <template v-else>
      <p>
        <strong>{{ currentJudging.title }}.</strong> <span class="muted">{{ currentJudging.text }}</span>
      </p>
      <p v-if="state.noChooser">
        <strong>{{ t('lobby.noChooser') }}.</strong> <span class="muted">{{ t('lobby.noChooserText') }}</span>
      </p>
    </template>
  </section>

  <section class="panel stack">
    <h2>{{ t('lobby.categories') }}</h2>
    <template v-if="isHost">
      <p class="muted">{{ t('lobby.pickCategories') }}</p>
      <div class="categories">
        <label v-for="c in state.categories" :key="c.key" class="category" :class="{ on: c.selected }">
          <input type="checkbox" :checked="c.selected" @change="toggleCategory(c.key)" />
          <span>
            <strong>{{ text(c.label) }}</strong>
            <span class="muted">{{ c.description }}</span>
            <span class="count">{{ t('lobby.cardCount', { count: c.count }, c.count) }}</span>
          </span>
        </label>
      </div>
    </template>
    <p v-else class="muted">
      <template v-if="selected.length">{{ selectedNames }}</template>
      <template v-else>{{ t('lobby.noCategories') }}</template>
    </p>
    <p class="muted">
      {{ t('lobby.deckSize', { count: state.availableCards }, state.availableCards) }}
      <span v-if="!enoughCards" class="warn">
        {{ t('lobby.notEnoughCards', { players: players.length, handSize: state.handSize, needed: cardsNeeded }) }}
      </span>
    </p>
  </section>

  <section class="panel stack">
    <template v-if="isHost">
      <label class="row">
        {{ t('lobby.handSize') }}
        <input
          type="number"
          class="num"
          min="3"
          max="12"
          :value="state.handSize"
          @change="send('settings', { handSize: $event.target.value })"
        />
      </label>
      <label class="row">
        {{ t(state.noChooser ? 'lobby.roundsNoChooser' : 'lobby.rounds') }}
        <input
          type="number"
          class="num"
          min="1"
          max="10"
          :value="state.rounds"
          @change="send('settings', { rounds: $event.target.value })"
        />
      </label>
      <p class="muted">{{ t(state.noChooser ? 'lobby.gameLengthNoChooser' : 'lobby.gameLength', lengthWords) }}</p>
      <button class="primary" :disabled="missingPlayers > 0 || !enoughCards" @click="send('start')">
        <template v-if="missingPlayers > 0">{{ t('lobby.needMore', { count: missingPlayers }, missingPlayers) }}</template>
        <template v-else-if="!enoughCards">{{ t('lobby.chooseMoreCategories') }}</template>
        <template v-else>{{ $t('lobby.start') }}</template>
      </button>
    </template>
    <p v-else class="muted">
      {{ t(state.noChooser ? 'lobby.waitingToStartNoChooser' : 'lobby.waitingToStart', { handSize: state.handSize, ...lengthWords }) }}
    </p>
  </section>

  <section class="panel rules">
    <h3>{{ t('lobby.howItWorks') }}</h3>
    <ol>
      <li>{{ t(state.noChooser ? 'lobby.rule.wordRandom' : 'lobby.rule.word') }}</li>
      <li v-if="!state.hasImposter">{{ t(state.noChooser ? 'lobby.rule.everyoneSeesAll' : 'lobby.rule.everyoneSees') }}</li>
      <li v-else>{{ t(state.noChooser ? 'lobby.rule.oneInTheDarkAll' : 'lobby.rule.oneInTheDark', { hidden: t('table.hiddenWord') }) }}</li>
      <li v-if="state.hasImposter">{{ t('lobby.rule.bluff') }}</li>
      <li>{{ t('lobby.rule.reveal') }}</li>
      <li v-if="state.judging === 'favourite'">{{ t('lobby.rule.favourite', { points: state.pointsFavourite }) }}</li>
      <li v-else-if="state.judging === 'best'">{{ t('lobby.rule.everyoneVotesBest') }}</li>
      <li v-else-if="state.judging === 'chooser'">{{ t('lobby.rule.chooserDecides') }}</li>
      <li v-else>{{ t('lobby.rule.everyoneVotes') }}</li>
    </ol>
  </section>
</template>

<style scoped>
.num {
  width: 5rem;
}
.options,
.categories {
  display: grid;
  gap: 0.6rem;
}
.categories {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.option,
.category {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
  cursor: pointer;
}
.option.on,
.category.on {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, var(--bg-sunken));
}
.option.off {
  opacity: 0.55;
  cursor: default;
}
.option input,
.category input {
  width: auto;
  margin-top: 0.25rem;
  accent-color: var(--amber);
}
.option > span,
.category > span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.count {
  font-size: 0.8rem;
  color: var(--amber);
}
.warn {
  color: var(--danger);
}
.rules ol {
  margin: 0.6rem 0 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.35rem;
  color: var(--muted);
}
</style>
