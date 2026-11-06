// Shop and coin routes: the listing with your balance, buying, and asking for a refund.
import { REFUND_ITEM } from '../../shared/refunds.js';
import { ShopError, itemById } from '../shop.js';
import { handler } from './http.js';

/**
 * Registers GET /shop, POST /shop/buy and POST /refunds.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ shop: object, coins: object, achievements: object, refunds: object, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes; buying spends coins and settles achievements; a refund request is written down.
 */
export function registerShopRoutes(api, { shop, coins, achievements, refunds, requireUser }) {
  api.get('/shop', requireUser, (req, res) => res.json(shop.listing(req.user.id)));
  api.post('/shop/buy', requireUser, handler(async (req, res) => {
    const bought = shop.buy(req.user.id, req.body?.item);
    achievements.settle(req.user.id); // spending, and having bought from every part of the shop, can unlock achievements that pay coins
    res.json({ ...bought, balance: coins.balance(req.user.id) });
  }));
  // Asking for a refund.  It is the "Refunds" unlock that is being used here, so only its owners may, as with any other
  // item; the writing itself has to be long enough (see server/refunds.js).
  api.post('/refunds', requireUser, handler(async (req, res) => {
    if (!shop.owns(req.user.id, REFUND_ITEM)) throw new ShopError('notOwned', 403, { item: itemById(REFUND_ITEM).name });
    res.json(refunds.submit(req.user.id, req.body?.text));
  }));
}
