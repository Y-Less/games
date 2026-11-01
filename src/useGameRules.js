// The Help pop-up of a game: its written rules, fetched when first asked for.
import { ref } from 'vue';
import { api } from './api.js';
import { renderMarkdown } from './markdown.js';

/**
 * The rules of one game (call from a component's setup).
 * @param {() => string} game  returns the module id (read when needed, so a changed route is followed)
 * @returns {{ rules: import('vue').Ref<string | null>, showRules: import('vue').Ref<boolean>, openRules: () => Promise<void> }}
 *   rules: the rendered HTML once loaded; showRules: whether the pop-up is open; openRules: opens it (loading the rules first time)
 * Side effects: none until openRules is called.
 */
export function useGameRules(game) {
  const rules = ref(null); // rendered HTML once loaded
  const showRules = ref(false); // the Help pop-up, which shows the game's rules

  /**
   * Opens the rules pop-up, loading the rules the first time.
   * @returns {Promise<void>}
   * Side effects: sets showRules; fetches /api/games/<id>/rules once (a game without rules gets a short notice instead).
   */
  async function openRules() {
    showRules.value = true;
    if (rules.value !== null) return;
    try {
      rules.value = renderMarkdown(await api('GET', `/api/games/${game()}/rules`));
    } catch {
      rules.value = '<p>This game has no written rules yet.</p>';
    }
  }

  return { rules, showRules, openRules };
}
