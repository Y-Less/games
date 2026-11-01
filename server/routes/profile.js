// Profile routes: change settings, change password, and what other players see of people.
import { choicesChanged } from '../shop.js';
import { handler, tokenOf } from './http.js';

/**
 * Registers PATCH /me, POST /me/password and GET /players.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ auth: object, achievements: object, uploads: object, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes; a profile change may delete the user's old uploaded pictures and add to "Indecisive".
 */
export function registerProfileRoutes(api, { auth, achievements, uploads, requireUser }) {
  api.patch('/me', requireUser, handler(async (req, res) => {
    const { displayName, background, cardBack, nameStyle, avatar, markerColour, siteTheme, siteFont, backgroundAnimation, playAnimations, effectIntensity, effectSpeed, language } = req.body ?? {};
    const user = auth.updateProfile(req.user.id, { displayName, background, cardBack, nameStyle, avatar, markerColour, siteTheme, siteFont, backgroundAnimation, playAnimations, effectIntensity, effectSpeed, language });
    if (background !== undefined && user.background.type !== 'image') uploads.removeImages('bg', user.id);
    if (cardBack !== undefined && user.cardBack.type !== 'image') uploads.removeImages('cb', user.id);
    const changed = choicesChanged(req.user, user);
    if (changed) achievements.add('site', user.id, 'global.indecisive', changed); // "Indecisive": every shop item put on, from the shop or the profile
    res.json({ user });
  }));

  api.post('/me/password', requireUser, handler(async (req, res) => {
    await auth.changePassword(req.user.id, req.body?.currentPassword, req.body?.newPassword, tokenOf(req));
    res.json({ ok: true });
  }));

  // What other players see of people: GET /api/players?ids=1,2,3 -> { players: { 1: { displayName, nameStyle, avatar }, ... } }
  api.get('/players', requireUser, (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean).map(Number);
    res.json({ players: auth.publicProfiles(ids) });
  });
}
