// Shop and coin routes: the listing with your balance, and buying.
import { handler } from './http.js';

/**
 * Registers GET /shop and POST /shop/buy.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ shop: object, coins: object, achievements: object, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes; buying spends coins and settles achievements.
 */
export function registerShopRoutes(api, { shop, coins, achievements, requireUser }) {
  api.get('/shop', requireUser, (req, res) => res.json(shop.listing(req.user.id)));
  api.post('/shop/buy', requireUser, handler(async (req, res) => {
    const bought = shop.buy(req.user.id, req.body?.item);
    achievements.settle(req.user.id); // spending, and having bought from every part of the shop, can unlock achievements that pay coins
    res.json({ ...bought, balance: coins.balance(req.user.id) });
  }));
}
