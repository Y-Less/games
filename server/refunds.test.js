// Refund requests: the length check, what is kept, and the route that only the owners of "Refunds" may use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.js';
import { createRefunds } from './refunds.js';
import { itemById } from './shop.js';
import { register, withSite } from './fixtures/testkit.js';
import { REFUND_ITEM, REFUND_MAXIMUM_CHARACTERS, REFUND_MINIMUM_WORDS } from '../shared/refunds.js';

/** A piece of writing of exactly `n` words. */
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const LONG_ENOUGH = words(REFUND_MINIMUM_WORDS);

/** A database with one account in it, and the refunds on it. */
function withRefunds(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const { lastInsertRowid } = db
    .prepare("INSERT INTO users (username, username_lower, password_hash, display_name, created_at) VALUES ('Ann', 'ann', 'x', 'Ann', 0)")
    .run();
  return { db, refunds: createRefunds(db), userId: Number(lastInsertRowid) };
}

test('writing of a thousand words or more is filed, with its word count and when it was written', (t) => {
  const { db, refunds, userId } = withRefunds(t);
  const before = Date.now();
  const filed = refunds.submit(userId, LONG_ENOUGH);
  assert.equal(filed.words, REFUND_MINIMUM_WORDS);
  const row = db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(filed.id);
  assert.equal(row.user_id, userId);
  assert.equal(row.words, REFUND_MINIMUM_WORDS);
  assert.equal(row.text, LONG_ENOUGH);
  assert.ok(row.created_at >= before);
  assert.equal(refunds.countFor(userId), 1);
});

test('a word short is refused, and says how far off it was', (t) => {
  const { db, refunds, userId } = withRefunds(t);
  assert.throws(() => refunds.submit(userId, words(REFUND_MINIMUM_WORDS - 1)), (error) => {
    assert.equal(error.message, 'refundTooShort');
    assert.equal(error.status, 400);
    assert.deepEqual(error.params, { min: REFUND_MINIMUM_WORDS, n: REFUND_MINIMUM_WORDS - 1 });
    return true;
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM refund_requests').get().n, 0, 'nothing was kept');
});

test('nothing, and anything that is not writing at all, is refused rather than thrown over', (t) => {
  const { refunds, userId } = withRefunds(t);
  for (const nothing of ['', '   ', undefined, null, {}, [], 7]) {
    assert.throws(() => refunds.submit(userId, nothing), /refundTooShort/, JSON.stringify(nothing) ?? 'undefined');
  }
});

test('more than the longest allowed is refused even when it is long enough in words', (t) => {
  const { refunds, userId } = withRefunds(t);
  const huge = `${'x'.repeat(REFUND_MAXIMUM_CHARACTERS)} ${LONG_ENOUGH}`;
  assert.throws(() => refunds.submit(userId, huge), (error) => {
    assert.equal(error.message, 'refundTooLong');
    assert.deepEqual(error.params, { max: REFUND_MAXIMUM_CHARACTERS });
    return true;
  });
});

test('the writing is kept as it was written, apart from the space around it', (t) => {
  const { db, refunds, userId } = withRefunds(t);
  const filed = refunds.submit(userId, `\n  ${LONG_ENOUGH}  \n`);
  assert.equal(db.prepare('SELECT text FROM refund_requests WHERE id = ?').get(filed.id).text, LONG_ENOUGH);
});

test('Refunds is an unlock that costs a thousand Gilders', () => {
  const item = itemById(REFUND_ITEM);
  assert.equal(item.name, 'Refunds');
  assert.equal(item.type, 'unlock');
  assert.equal(item.price, 1000);
});

test('only somebody who has bought Refunds may ask for one, and then only at length', async (t) => {
  const env = await withSite(t, { shopLocked: true });
  const c = env.client();
  const { data } = await register(c, 'shopper', 'password1');
  const userId = data.user.id;

  const refused = await c.post('/api/refunds', { text: LONG_ENOUGH });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error, 'notOwned');
  assert.equal(refused.data.params.item, 'Refunds');

  env.site.db.prepare("INSERT INTO coin_ledger (user_id, amount, reason, created_at) VALUES (?, 1000, 'test', 0)").run(userId);
  assert.equal((await c.post('/api/shop/buy', { item: REFUND_ITEM })).status, 200);

  const short = await c.post('/api/refunds', { text: 'Give me my money back.' });
  assert.equal(short.status, 400);
  assert.equal(short.data.error, 'refundTooShort');
  assert.deepEqual(short.data.params, { min: REFUND_MINIMUM_WORDS, n: 5 });

  const sent = await c.post('/api/refunds', { text: LONG_ENOUGH });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.words, REFUND_MINIMUM_WORDS);
  const row = env.site.db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(sent.data.id);
  assert.equal(row.user_id, userId);
  assert.equal(row.text, LONG_ENOUGH);
});

test('a request written in letters that take two bytes apiece still arrives, though it is past the ordinary body limit', async (t) => {
  const env = await withSite(t); // every account owns everything here
  const c = env.client();
  await register(c, 'wordy', 'password1');
  // This is why the route is given a body of its own: in Cyrillic a request well inside the character limit is already
  // more bytes than the 20kb every other route allows.
  const essay = Array.from({ length: 1200 }, (_, i) => `возврат${i}`).join(' ');
  assert.ok(essay.length < REFUND_MAXIMUM_CHARACTERS, 'short enough to be allowed');
  assert.ok(Buffer.byteLength(essay, 'utf8') > 20 * 1024, 'but more bytes than the ordinary limit');
  const sent = await c.post('/api/refunds', { text: essay });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.words, 1200);
});

test('signing in is needed to ask for a refund', async (t) => {
  const env = await withSite(t);
  assert.equal((await env.client().post('/api/refunds', { text: LONG_ENOUGH })).status, 401);
});
