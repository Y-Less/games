// The shop: the catalogue, buying with coins, and the server refusing profile choices the player has not bought.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { allItems, itemById } from './shop.js';
import { png, register, withSite } from './fixtures/testkit.js';

async function shopSite(t, { coins = 0 } = {}) {
  const env = await withSite(t, { shopLocked: true });
  const c = env.client();
  const { data } = await register(c, 'shopper', 'password1');
  const user = data.user;
  if (coins) env.site.db.prepare("INSERT INTO coin_ledger (user_id, amount, reason, created_at) VALUES (?, ?, 'test', 0)").run(user.id, coins);
  return { ...env, c, user };
}

test('the catalogue: unique ids, whole prices, and a free starting background and card back', () => {
  const items = allItems();
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const item of items) assert.ok(Number.isInteger(item.price) && item.price >= 0, item.id);
  assert.equal(itemById('bg:night').price, 0);
  assert.equal(itemById('cb:crimson').price, 0);
  assert.ok(itemById('bg:ocean').price > 0);
  assert.equal(itemById('nothing'), null);
});

test('the listing shows the balance, with free items owned and the rest not', async (t) => {
  const { c } = await shopSite(t, { coins: 250 });
  const { status, data } = await c.get('/api/shop');
  assert.equal(status, 200);
  assert.equal(data.balance, 250);
  const owned = (id) => data.items.find((i) => i.id === id).owned;
  assert.equal(owned('bg:night'), true);
  assert.equal(owned('cb:crimson'), true);
  assert.equal(owned('bg:ocean'), false);
});

test('the shop needs a signed-in user', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  assert.equal((await c.get('/api/shop')).status, 401);
  assert.equal((await c.post('/api/shop/buy', { item: 'bg:ocean' })).status, 401);
});

test('buying takes the price, and the item can then be used', async (t) => {
  const { c } = await shopSite(t, { coins: 700 });
  assert.equal((await c.patch('/api/me', { background: { type: 'preset', value: 'ocean' } })).status, 403);
  const bought = await c.post('/api/shop/buy', { item: 'bg:ocean' });
  assert.equal(bought.status, 200);
  assert.equal(bought.data.balance, 200);
  assert.equal((await c.get('/api/shop')).data.items.find((i) => i.id === 'bg:ocean').owned, true);
  const changed = await c.patch('/api/me', { background: { type: 'preset', value: 'ocean' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.user.background.value, 'ocean');
});

test('buying is refused when it cannot be afforded, is already owned, or is not for sale', async (t) => {
  const { c } = await shopSite(t, { coins: 499 });
  assert.equal((await c.post('/api/shop/buy', { item: 'bg:ocean' })).status, 402);
  assert.equal((await c.get('/api/shop')).data.balance, 499, 'a refused purchase costs nothing');
  assert.equal((await c.post('/api/shop/buy', { item: 'bg:night' })).status, 409, 'a free item is already yours');
  assert.equal((await c.post('/api/shop/buy', { item: 'cb:teal' })).status, 200);
  assert.equal((await c.post('/api/shop/buy', { item: 'cb:teal' })).status, 409);
  assert.equal((await c.get('/api/shop')).data.balance, 199, 'an item is only paid for once');
  for (const item of ['nothing', '', null, 7, { id: 'bg:ocean' }, undefined]) {
    assert.equal((await c.post('/api/shop/buy', { item })).status, 404, JSON.stringify(item));
  }
});

test("one person's purchase is not another's", async (t) => {
  const { c, client } = await (async () => {
    const env = await shopSite(t, { coins: 1000 });
    return { c: env.c, client: env.client };
  })();
  await c.post('/api/shop/buy', { item: 'cb:gold' });
  const other = client();
  await register(other, 'other', 'password1');
  assert.equal((await other.patch('/api/me', { cardBack: { type: 'preset', value: 'gold' } })).status, 403);
});

test('the free starting choices need nothing, and a refused change changes nothing', async (t) => {
  const { c } = await shopSite(t);
  const night = await c.patch('/api/me', { background: { type: 'preset', value: 'night' }, cardBack: { type: 'preset', value: 'crimson' } });
  assert.equal(night.status, 200);
  const refused = await c.patch('/api/me', { displayName: 'Renamed', background: { type: 'preset', value: 'dusk' } });
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /Dusk/);
  assert.equal((await c.get('/api/me')).data.user.displayName, 'shopper');
});

test('colours, gradients and uploads are separate unlocks', async (t) => {
  const { c, dataDir } = await shopSite(t, { coins: 5000 });
  const colour = { type: 'colour', value: '#112233' };
  const gradient = { type: 'gradient', from: '#112233', to: '#445566', angle: 90 };
  assert.equal((await c.patch('/api/me', { background: colour })).status, 403);
  assert.equal((await c.patch('/api/me', { background: gradient })).status, 403);
  await c.post('/api/shop/buy', { item: 'bg-colour' });
  assert.equal((await c.patch('/api/me', { background: colour })).status, 200);
  assert.equal((await c.patch('/api/me', { background: gradient })).status, 403, 'a colour does not unlock gradients');

  const uploads = path.join(dataDir, 'uploads');
  assert.equal((await c.raw('/api/me/background-image', png(), 'image/png')).status, 403);
  assert.equal((await c.raw('/api/me/card-back-image', png(), 'image/png')).status, 403);
  assert.deepEqual(fs.readdirSync(uploads), [], 'nothing was stored for a refused upload');
  await c.post('/api/shop/buy', { item: 'bg-upload' });
  assert.equal((await c.raw('/api/me/background-image', png(), 'image/png')).status, 200);
  assert.equal((await c.raw('/api/me/card-back-image', png(), 'image/png')).status, 403, 'the card back picture is its own unlock');
});
