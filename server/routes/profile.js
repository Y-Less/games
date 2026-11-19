// Profile routes: change settings, change password, and what other players see of people.
import { choicesChanged } from '../shop.js';
import { SETTING_KEYS } from '../profile.js';
import { handler, tokenOf } from './http.js';

/**
 * Registers PATCH /me, POST /me/password and GET /players.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ auth: object, achievements: object, uploads: object, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes; a profile change may delete the user's old uploaded pictures, add to "Indecisive" and
 * settle the achievements that a setting can unlock (choosing Klingon).
 */
export function registerProfileRoutes(api, { auth, achievements, uploads, requireUser }) {
  api.patch('/me', requireUser, handler(async (req, res) => {
    // The settings themselves are server/profile.js's list, read off it rather than written out again here: a route
    // with its own copy drops a setting added to the other one, silently, and answers 200 as though it had saved it.
    const changes = Object.fromEntries(SETTING_KEYS.map((key) => [key, req.body?.[key]]));
    const user = auth.updateProfile(req.user.id, changes);
    if (changes.background !== undefined && user.background.type !== 'image') uploads.removeImages('bg', user.id);
    if (changes.cardBack !== undefined && user.cardBack.type !== 'image') uploads.removeImages('cb', user.id);
    const changed = choicesChanged(req.user, user);
    if (changed) achievements.add('site', user.id, 'global.indecisive', changed); // "Indecisive": every shop item put on, from the shop or the profile
    if (user.language === 'tlh') achievements.raise('site', user.id, 'global.klingon', 1); // "Qapla'": chosen Klingon, and it stays chosen
    achievements.settle(user.id); // a setting can unlock something by itself, without waiting for a game to end
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
