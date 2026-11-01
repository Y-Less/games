// Game and site configuration routes: the menu's game list with the presets, and a game's rules.
import { BACKGROUND_PRESETS, CARD_BACK_PRESETS } from '../profileSettings.js';

/**
 * Registers GET /config and GET /games/:id/rules (with an optional ?lang=).
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ modules: { rules: (id: string, lang?: string) => string | null }, listGames: () => object[], requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes.
 */
export function registerGameRoutes(api, { modules, listGames, requireUser }) {
  api.get('/config', (req, res) => res.json({ games: listGames(), backgrounds: BACKGROUND_PRESETS, cardBacks: CARD_BACK_PRESETS }));
  // ?lang=fr asks for rules.fr.md, falling back to the module's rules.md.
  api.get('/games/:id/rules', requireUser, (req, res) => {
    const text = modules.rules(req.params.id, typeof req.query.lang === 'string' ? req.query.lang : '');
    if (text === null) return res.status(404).json({ error: 'noRules' });
    res.type('text/plain').send(text);
  });
}
