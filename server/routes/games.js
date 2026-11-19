// Game and site configuration routes: the menu's game list with the presets, and a game's rules.
import { BACKGROUND_PRESETS, CARD_BACK_PRESETS } from '../profileSettings.js';

/**
 * Registers GET /config, GET /games/:id/rules (with an optional ?lang=) and GET /my/games.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ modules: { rules: (id: string, lang?: string) => string | null, gamesOf?: (userId: number) => object[] }, listGames: () => object[], requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes.
 */
export function registerGameRoutes(api, { modules, listGames, requireUser }) {
  // The games this person has on the go, in every module.  It is asked for rather than pushed because a game set
  // aside yesterday may have been waiting since: there is no event to have missed, only a state to read.
  api.get('/my/games', requireUser, (req, res) => res.json({ games: modules.gamesOf?.(req.user.id) ?? [] }));
  api.get('/config', (req, res) => res.json({ games: listGames(), backgrounds: BACKGROUND_PRESETS, cardBacks: CARD_BACK_PRESETS }));
  // ?lang=fr asks for rules.fr.md, falling back to the module's rules.md.
  api.get('/games/:id/rules', requireUser, (req, res) => {
    const text = modules.rules(req.params.id, typeof req.query.lang === 'string' ? req.query.lang : '');
    if (text === null) return res.status(404).json({ error: 'noRules' });
    res.type('text/plain').send(text);
  });
}
