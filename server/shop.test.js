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

test('name styles: plain is free, the rest are bought, and a bad style is refused', async (t) => {
  const { c } = await shopSite(t, { coins: 650 });
  assert.deepEqual((await c.get('/api/me')).data.user.nameStyle, { style: 'plain' });
  assert.equal((await c.patch('/api/me', { nameStyle: { style: 'plain' } })).status, 200);
  assert.equal((await c.patch('/api/me', { nameStyle: { style: 'gold' } })).status, 403);
  for (const nameStyle of [{ style: 'nonsense' }, { style: 7 }, {}, null, 'gold', { style: '__proto__' }]) {
    assert.equal((await c.patch('/api/me', { nameStyle })).status, 400, JSON.stringify(nameStyle));
  }
  assert.equal((await c.post('/api/shop/buy', { item: 'ns:ruby' })).status, 200);
  const changed = await c.patch('/api/me', { nameStyle: { style: 'ruby' } });
  assert.deepEqual(changed.data.user.nameStyle, { style: 'ruby' });
});

test('players: anyone signed in can see names and name styles, and nothing more', async (t) => {
  const { c, user, client } = await shopSite(t, { coins: 650 });
  await c.post('/api/shop/buy', { item: 'ns:ruby' });
  await c.patch('/api/me', { nameStyle: { style: 'ruby' } });
  const other = client();
  const { data } = await register(other, 'watcher', 'password1');
  const { status, data: seen } = await other.get(`/api/players?ids=${user.id},${data.user.id},9999,abc,-1`);
  assert.equal(status, 200);
  assert.deepEqual({ ...seen.players[user.id], avatar: undefined }, { displayName: 'shopper', nameStyle: { style: 'ruby' }, avatar: undefined });
  assert.deepEqual({ ...seen.players[data.user.id], avatar: undefined }, { displayName: 'watcher', nameStyle: { style: 'plain' }, avatar: undefined });
  assert.deepEqual(Object.keys(seen.players).sort(), [String(user.id), String(data.user.id)].sort());
  assert.deepEqual((await other.get('/api/players')).data, { players: {} });
  assert.equal((await client().get('/api/players?ids=1')).status, 401);
});

test('avatars: free parts belong to everyone, the rest are bought, and a bad avatar is refused', async (t) => {
  const { c } = await shopSite(t, { coins: 200 });
  const first = (await c.get('/api/me')).data.user.avatar;
  assert.equal(first.hair, 'short');
  assert.equal((await c.patch('/api/me', { avatar: { ...first, skin: 'brown' } })).status, 200);
  assert.equal((await c.patch('/api/me', { avatar: { ...first, hair: 'curly' } })).status, 403);
  for (const avatar of [null, 'curly', [], { hair: 'nonsense' }, { hair: 7 }, { hair: '__proto__' }]) {
    assert.equal((await c.patch('/api/me', { avatar })).status, 400, JSON.stringify(avatar));
  }
  assert.equal((await c.post('/api/shop/buy', { item: 'av:hair:curly' })).status, 200);
  const changed = await c.patch('/api/me', { avatar: { hair: 'curly', skin: 'tan' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.user.avatar.hair, 'curly');
  assert.equal(changed.data.user.avatar.eyes, first.eyes, 'a slot left out gets the default');
});

test('players: other players see the avatar', async (t) => {
  const { c, user, client } = await shopSite(t);
  await c.patch('/api/me', { avatar: { skin: 'deep' } });
  const other = client();
  await register(other, 'watcher', 'password1');
  const { data } = await other.get(`/api/players?ids=${user.id}`);
  assert.equal(data.players[user.id].avatar.skin, 'deep');
});

test('animations: the still choice is free, the rest are bought, and a bad one is refused', async (t) => {
  const { c } = await shopSite(t, { coins: 1300 });
  assert.equal((await c.get('/api/me')).data.user.backgroundAnimation, 'none');
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'none' })).status, 200);
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'stars' })).status, 403);
  assert.equal((await c.patch('/api/me', { nameStyle: { style: 'plain', animation: 'glow' } })).status, 403);
  for (const backgroundAnimation of ['glow', '', 7, null, '__proto__']) {
    assert.equal((await c.patch('/api/me', { backgroundAnimation })).status, 400, JSON.stringify(backgroundAnimation));
  }
  for (const nameStyle of [{ style: 'plain', animation: 'stars' }, { style: 'plain', animation: 7 }, { style: 'plain', animation: '__proto__' }]) {
    assert.equal((await c.patch('/api/me', { nameStyle })).status, 400, JSON.stringify(nameStyle));
  }
  assert.equal((await c.post('/api/shop/buy', { item: 'ba:stars' })).status, 200);
  assert.equal((await c.post('/api/shop/buy', { item: 'na:glow' })).status, 200);
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'stars' })).data.user.backgroundAnimation, 'stars');
  const named = await c.patch('/api/me', { nameStyle: { style: 'plain', animation: 'glow' } });
  assert.deepEqual(named.data.user.nameStyle, { style: 'plain', animation: 'glow' });
  const still = await c.patch('/api/me', { nameStyle: { style: 'plain', animation: 'none' } });
  assert.deepEqual(still.data.user.nameStyle, { style: 'plain' }, 'a still name is stored without an animation');
});

test('players: others see a name animation but not your background animation', async (t) => {
  const { c, user, client } = await shopSite(t, { coins: 3000 });
  await c.post('/api/shop/buy', { item: 'na:rainbow' });
  await c.post('/api/shop/buy', { item: 'ba:aurora' });
  await c.patch('/api/me', { nameStyle: { style: 'plain', animation: 'rainbow' }, backgroundAnimation: 'aurora' });
  const other = client();
  await register(other, 'watcher', 'password1');
  const { data } = await other.get(`/api/players?ids=${user.id}`);
  assert.deepEqual(data.players[user.id].nameStyle, { style: 'plain', animation: 'rainbow' });
  assert.equal('backgroundAnimation' in data.players[user.id], false);
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
