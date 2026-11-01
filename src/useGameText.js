// Words inside a game's components. A module's components call `useGameText()`; its `t('lobby.intro')` reads the game's own
// locale file (modules/<id>/locales/<lang>.json) and falls back to the site's keys, `text(value)` puts a server message
// into words and `error(reply)` a refusal. The game's id comes from the play view (provide) so no component names it;
// a shared component (ScoreBoard, say) gets the same answers for whichever game it is drawn in.
// Depends on: vue (inject), vue-i18n (useI18n) and ./messageText.js.
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorText, keyFor, listText, messageText } from './messageText.js';

/** The injection key under which the play view provides the module id being played. */
export const GAME_ID = Symbol('gameId');

/**
 * The text helpers for the game being drawn (call from setup).
 * @param {string | null} [id]  the module id; left out, it is injected from the play view (null outside a game)
 * @returns {{ t: Function, text: (value: *) => string, error: (reply: object) => string, list: (items: string[]) => string, game: string | null, locale: import('vue').Ref<string> }}
 *   `t(key, ...)` as vue-i18n's, with the game's keys tried first; `text` and `error` as messageText.js
 * Side effects: none.
 */
export function useGameText(id) {
  const game = id === undefined ? inject(GAME_ID, null) : id;
  const { t: raw, locale } = useI18n();
  return {
    game,
    locale,
    t: (key, ...args) => raw(keyFor(key, game), ...args),
    text: (value) => messageText(value, game),
    error: (reply) => errorText(reply, game),
    list: listText,
  };
}
