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

test('the intensity and speed sliders are unlocks: normal is free, other levels need them, and bad levels are refused', async (t) => {
  const { c } = await shopSite(t, { coins: 1500 });
  const me = (await c.get('/api/me')).data.user;
  assert.deepEqual([me.effectIntensity, me.effectSpeed], [100, 100]);
  assert.equal((await c.patch('/api/me', { effectIntensity: 100, effectSpeed: 100 })).status, 200);
  assert.equal((await c.patch('/api/me', { effectIntensity: 50 })).status, 403);
  assert.equal((await c.patch('/api/me', { effectSpeed: 200 })).status, 403);
  for (const effectIntensity of [0, 9, 301, 50.5, '50', null]) assert.equal((await c.patch('/api/me', { effectIntensity })).status, 400, JSON.stringify(effectIntensity));
  for (const effectSpeed of [0, 24, 301, '100', null]) assert.equal((await c.patch('/api/me', { effectSpeed })).status, 400, JSON.stringify(effectSpeed));
  assert.equal((await c.post('/api/shop/buy', { item: 'fx-intensity' })).status, 200);
  assert.equal((await c.post('/api/shop/buy', { item: 'fx-speed' })).status, 200);
  const set = (await c.patch('/api/me', { effectIntensity: 240, effectSpeed: 250 })).data.user;
  assert.deepEqual([set.effectIntensity, set.effectSpeed], [240, 250]);
  assert.equal((await c.get('/api/me')).data.user.effectSpeed, 250);
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

test('the play-animations setting follows the device by default, and can be always, never or back to the device', async (t) => {
  const { c } = await shopSite(t);
  assert.equal((await c.get('/api/me')).data.user.playAnimations, null);
  assert.equal((await c.patch('/api/me', { playAnimations: false })).data.user.playAnimations, false);
  assert.equal((await c.get('/api/me')).data.user.playAnimations, false);
  assert.equal((await c.patch('/api/me', { playAnimations: true })).data.user.playAnimations, true);
  for (const playAnimations of ['no', 0, 1, {}, []]) {
    assert.equal((await c.patch('/api/me', { playAnimations })).status, 400, JSON.stringify(playAnimations));
  }
  assert.equal((await c.patch('/api/me', { playAnimations: null })).data.user.playAnimations, null);
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

test('marker colour: none by default, the free palette is free, any other colour is an unlock, and bad ones are refused', async (t) => {
  const { c } = await shopSite(t, { coins: 5000 });
  assert.equal((await c.get('/api/me')).data.user.markerColour, null);
  assert.equal((await c.patch('/api/me', { markerColour: '#FF2D95' })).data.user.markerColour, '#ff2d95', 'a free colour, kept in lower case');
  assert.equal((await c.patch('/api/me', { markerColour: '#123456' })).status, 403, 'any other colour needs the unlock');
  assert.equal((await c.get('/api/me')).data.user.markerColour, '#ff2d95', 'a refused change changes nothing');
  for (const bad of ['red', '#12345', '#1234567', 7, {}, '']) assert.equal((await c.patch('/api/me', { markerColour: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await c.patch('/api/me', { markerColour: null })).data.user.markerColour, null, 'null clears it');
  await c.post('/api/shop/buy', { item: 'marker-colour' });
  assert.equal((await c.patch('/api/me', { markerColour: '#123456' })).data.user.markerColour, '#123456');
  assert.equal((await c.patch('/api/me', { displayName: 'Ann' })).data.user.markerColour, '#123456', 'other changes leave it alone');
});

test('the shop sells Matrix (matrix-a) as "Matrix", and Matrix B is not for sale or choosable', async (t) => {
  assert.equal(itemById('ba:matrix-a').name, 'Matrix');
  assert.equal(itemById('ba:matrix'), null, 'Matrix B is not in the catalogue');
  assert.ok(!allItems().some((i) => /Matrix B/.test(i.name)));
  const { c } = await shopSite(t, { coins: 5000 });
  assert.equal((await c.post('/api/shop/buy', { item: 'ba:matrix' })).status, 404, 'it cannot be bought');
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'matrix' })).status, 403, 'and cannot be chosen');
  assert.equal((await c.post('/api/shop/buy', { item: 'ba:matrix-a' })).status, 200);
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'matrix-a' })).data.user.backgroundAnimation, 'matrix-a');
});

test('every card back preset is in the shop: crimson free, the rest 300 coins, with a readable name', () => {
  const backs = allItems().filter((i) => i.type === 'card-back');
  assert.equal(backs.length, 20);
  assert.equal(backs.filter((i) => i.price === 0).map((i) => i.id).join(), 'cb:crimson');
  for (const b of backs.filter((i) => i.id !== 'cb:crimson')) assert.equal(b.price, 300, b.id);
  assert.ok(backs.every((b) => /^[A-Z][a-z]+$/.test(b.name)), backs.map((b) => b.name).join());
});

test('wine, lagoon and violet are backgrounds for sale at the usual price', () => {
  for (const key of ['wine', 'lagoon', 'violet']) {
    const item = itemById(`bg:${key}`);
    assert.ok(item, key);
    assert.equal(item.price, 500, key);
    assert.equal(item.type, 'background');
  }
});

test('Fireflies and Rain are background animations for sale, and a player can use them once bought', async (t) => {
  assert.equal(itemById('ba:fireflies').price, 1000);
  assert.equal(itemById('ba:rain').price, 800);
  const { c } = await shopSite(t, { coins: 5000 });
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'rain' })).status, 403, 'not before buying');
  for (const item of ['ba:fireflies', 'ba:rain']) assert.equal((await c.post('/api/shop/buy', { item })).status, 200);
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'fireflies' })).data.user.backgroundAnimation, 'fireflies');
  assert.equal((await c.patch('/api/me', { backgroundAnimation: 'rain' })).data.user.backgroundAnimation, 'rain');
});

test('Neon flicker (border) and Northern lights (background) are name animations for sale, usable once bought', async (t) => {
  assert.deepEqual([itemById('na:neon').price, itemById('na:neon').part], [700, 'border']);
  assert.deepEqual([itemById('na:aurora').price, itemById('na:aurora').part], [1200, 'background']);
  const { c } = await shopSite(t, { coins: 5000 });
  assert.equal((await c.patch('/api/me', { nameStyle: { style: 'plain', animation: 'neon' } })).status, 403, 'not before buying');
  for (const item of ['na:neon', 'na:aurora']) assert.equal((await c.post('/api/shop/buy', { item })).status, 200);
  assert.deepEqual((await c.patch('/api/me', { nameStyle: { style: 'plain', animation: 'neon' } })).data.user.nameStyle, { style: 'plain', animation: 'neon' });
  assert.deepEqual((await c.patch('/api/me', { nameStyle: { style: 'plain', animation: 'aurora' } })).data.user.nameStyle, { style: 'plain', animation: 'aurora' });
});

test('Obsidian, Ocean, Ember and Toxic are name styles for sale, usable once bought, and all styles are well formed', async (t) => {
  const { NAME_STYLES } = await import('../shared/nameStyles.js');
  const expected = { obsidian: 1000, ocean: 1500, ember: 1500, toxic: 1000 };
  for (const [id, price] of Object.entries(expected)) assert.equal(itemById(`ns:${id}`).price, price, id);
  for (const style of NAME_STYLES) {
    assert.ok(style.name && style.border && style.fill, style.id);
    assert.ok(Number.isInteger(style.price) && style.price >= 0, style.id);
  }
  assert.equal(new Set(NAME_STYLES.map((s) => s.id)).size, NAME_STYLES.length);
  const { c } = await shopSite(t, { coins: 9000 });
  assert.equal((await c.patch('/api/me', { nameStyle: { style: 'ember' } })).status, 403, 'not before buying');
  for (const id of Object.keys(expected)) {
    assert.equal((await c.post('/api/shop/buy', { item: `ns:${id}` })).status, 200, id);
    assert.deepEqual((await c.patch('/api/me', { nameStyle: { style: id } })).data.user.nameStyle, { style: id });
  }
});

test('site themes and fonts: the first of each is free and the default, the rest are bought, and bad ones are refused', async (t) => {
  const { c } = await shopSite(t, { coins: 1000 });
  const me = (await c.get('/api/me')).data.user;
  assert.deepEqual([me.siteTheme, me.siteFont], ['harbour', 'sans'], 'sans-serif is the default font');
  assert.equal(itemById('st:harbour').price, 0);
  assert.equal(itemById('sf:sans').price, 0);
  assert.equal((await c.patch('/api/me', { siteTheme: 'harbour', siteFont: 'sans' })).status, 200);
  assert.equal((await c.patch('/api/me', { siteTheme: 'plum' })).status, 403, 'a theme has to be bought');
  assert.equal((await c.patch('/api/me', { siteFont: 'serif' })).status, 403, 'and so does a font');
  for (const bad of ['nope', 7, null, {}, '']) {
    assert.equal((await c.patch('/api/me', { siteTheme: bad })).status, 400, `theme ${JSON.stringify(bad)}`);
    assert.equal((await c.patch('/api/me', { siteFont: bad })).status, 400, `font ${JSON.stringify(bad)}`);
  }
  assert.equal((await c.post('/api/shop/buy', { item: 'st:plum' })).status, 200);
  assert.equal((await c.post('/api/shop/buy', { item: 'sf:serif' })).status, 200);
  const after = (await c.patch('/api/me', { siteTheme: 'plum', siteFont: 'serif' })).data.user;
  assert.deepEqual([after.siteTheme, after.siteFont], ['plum', 'serif']);
  assert.equal((await c.patch('/api/me', { displayName: 'Ann' })).data.user.siteTheme, 'plum', 'other changes leave it alone');
});
