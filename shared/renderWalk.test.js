// The helper every game's "render everything" client test stands on (shared/renderWalk.js): it mounts a game's root
// component on a stand-in socket, feeds it every view a seeded game produced, and collects whatever goes wrong.  A
// helper like that fails silently in the worst way: if it stopped sending views, or stopped noticing errors, sixteen
// render-all tests would go on passing while checking nothing.  So what is protected here is that it sends what it
// says it sends, and that each kind of problem it promises to collect really is collected.
//
// The client tests run under vitest and jsdom; this file runs under node:test like the rest of shared/, so it makes
// the page itself (jsdom is already a development dependency) before Vue is loaded, which looks for one as it starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const page = new JSDOM('<!doctype html><html><body></body></html>');
for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment', 'DocumentFragment', 'Event', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
  if (!(name in globalThis)) Object.defineProperty(globalThis, name, { value: page.window[name], configurable: true, writable: true });
}

const { h } = await import('vue');
const { fakeSocket, isMemberView, walkViews } = await import('./renderWalk.js');

// ---- the stand-in socket ----

test('the stand-in socket is connected, remembers the handlers a component registers, and fires them', () => {
  const socket = fakeSocket();
  assert.equal(socket.connected, true);
  const seen = [];
  socket.on('state', (...args) => seen.push(args));
  assert.equal(typeof socket.handlers.state, 'function');
  socket.fire('state', { phase: 'lobby' }, 'second');
  assert.deepEqual(seen, [[{ phase: 'lobby' }, 'second']]);
});

test('firing an event nothing listens for does nothing, and a handler taken off is no longer called', () => {
  const socket = fakeSocket();
  assert.doesNotThrow(() => socket.fire('state', {}));
  let calls = 0;
  socket.on('state', () => calls++);
  socket.off('state');
  socket.fire('state', {});
  assert.equal(calls, 0);
  assert.equal('state' in socket.handlers, false);
});

test('every emit is answered with { ok: true }, and one sent without an ack is simply accepted', () => {
  const socket = fakeSocket();
  const replies = [];
  socket.emit('play', { card: 'AS' }, (reply) => replies.push(reply));
  socket.emit('start', undefined, (reply) => replies.push(reply));
  assert.deepEqual(replies, [{ ok: true }, { ok: true }]);
  assert.doesNotThrow(() => socket.emit('play', { card: 'AS' }));
  assert.doesNotThrow(() => socket.emit('play'));
  assert.doesNotThrow(() => socket.close());
});

test('a resume with a code gets that code back, as the server would send it', () => {
  const socket = fakeSocket();
  let reply;
  socket.emit('resume', { code: 'boss-aware-you' }, (r) => (reply = r));
  assert.deepEqual(reply, { ok: true, code: 'boss-aware-you' });
});

test('two stand-in sockets share nothing', () => {
  const one = fakeSocket();
  const two = fakeSocket();
  one.on('state', () => {});
  assert.deepEqual(Object.keys(two.handlers), []);
});

// ---- whose view is it? ----

test('no view at all is not a member’s view', () => {
  assert.equal(isMemberView(null), false);
  assert.equal(isMemberView(undefined), false);
});

test('a seated game: the view of somebody at the table is a member’s, and a stranger’s is not', () => {
  const seats = [{ name: 'Ann' }, null, { name: 'Bob' }, null];
  assert.equal(isMemberView({ seats, you: 0 }), true);
  assert.equal(isMemberView({ seats, you: 2 }), true);
  assert.equal(isMemberView({ seats, you: -1 }), false, 'somebody at no seat');
  assert.equal(isMemberView({ seats, you: 1 }), false, 'an empty seat is nobody');
});

test('a list game: the view of somebody in the list is a member’s, and a stranger’s is not', () => {
  const players = [{ id: 1 }, { id: 'bot:1' }, { id: 2 }];
  assert.equal(isMemberView({ players, you: 2 }), true);
  assert.equal(isMemberView({ players, you: 3 }), false);
  assert.equal(isMemberView({ players: [], you: 1 }), false);
});

test('a view that says who "me" is: a member has an id, and an outsider has none', () => {
  assert.equal(isMemberView({ me: { id: 4 }, players: [] }), true);
  assert.equal(isMemberView({ me: { id: null }, players: [{ id: 4 }] }), false);
  assert.equal(isMemberView({ me: null, players: [{ id: 4 }] }), false);
});

// ---- walking the views ----

/** A root component that notes the props it was given and every view it is sent, and draws the phase. */
function recorder(seen) {
  return {
    props: ['socket', 'user', 'search', 'setSearch'],
    data: () => ({ view: null }),
    created() {
      seen.props = { ...this.$props };
      seen.events = [];
      this.socket.on('connect', () => seen.events.push('connect'));
      this.socket.on('state', (view) => {
        seen.events.push(view);
        this.view = view;
      });
    },
    render() {
      return h('main', this.view ? `phase ${this.view.phase}` : 'waiting');
    },
  };
}

const view = (phase, extra = {}) => ({ phase, players: [{ id: 1 }], you: 1, ...extra });

test('every view is sent in order, after the socket has said it is connected, and nothing is reported for a table that draws them', async () => {
  const seen = {};
  const views = [view('lobby'), view('playing'), view('finished')];
  const result = await walkViews(recorder(seen), views);
  assert.deepEqual(result, { sent: 3, problems: [] });
  assert.deepEqual(seen.events, ['connect', ...views]);
});

test('the component is given what the play view gives it: the socket, the signed-in user, and the search', async () => {
  const seen = {};
  await walkViews(recorder(seen), []);
  assert.equal(typeof seen.props.socket.emit, 'function');
  assert.deepEqual(seen.props.user, { id: 1, displayName: 'Ann' });
  assert.equal(seen.props.search, '');
  assert.equal(typeof seen.props.setSearch, 'function');
  const other = {};
  await walkViews(recorder(other), [], { user: { id: 9, displayName: 'Zed' } });
  assert.deepEqual(other.props.user, { id: 9, displayName: 'Zed' });
});

test('views recorded as JSON text are read before they are sent', async () => {
  const seen = {};
  const result = await walkViews(recorder(seen), [JSON.stringify(view('lobby')), view('playing')]);
  assert.equal(result.sent, 2);
  assert.deepEqual(seen.events.slice(1), [view('lobby'), view('playing')]);
});

test('by default only the views a member would receive are sent, and not counted otherwise', async () => {
  const seen = {};
  const result = await walkViews(recorder(seen), [view('lobby'), null, view('playing', { you: 99 }), 'null', view('finished')]);
  assert.equal(result.sent, 2);
  assert.deepEqual(seen.events.slice(1).map((sent) => sent.phase), ['lobby', 'finished']);
  assert.deepEqual(result.problems, []);
});

test('a test may say for itself which views to keep', async () => {
  const seen = {};
  const result = await walkViews(recorder(seen), [view('lobby'), view('playing'), view('finished')], { keep: (each) => each.phase !== 'playing' });
  assert.equal(result.sent, 2);
  assert.deepEqual(seen.events.slice(1).map((sent) => sent.phase), ['lobby', 'finished']);
});

test('a view is decorated the way the server would before it is sent', async () => {
  const seen = {};
  await walkViews(recorder(seen), [view('lobby')], { decorate: (each) => ({ ...each, code: 'a-b-c' }) });
  assert.deepEqual(seen.events.slice(1), [view('lobby', { code: 'a-b-c' })]);
});

test('with a step, every step-th kept view is sent, counting only the ones kept', async () => {
  const seen = {};
  const views = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((phase) => view(phase));
  views.splice(1, 0, null, null); // strangers' views in between do not shift which ones are chosen
  const result = await walkViews(recorder(seen), views, { step: 3 });
  assert.equal(result.sent, 3);
  assert.deepEqual(seen.events.slice(1).map((sent) => sent.phase), ['a', 'd', 'g']);
});

test('a table that throws while drawing a view is reported, not thrown, and the walk says what went wrong', async () => {
  const Broken = {
    props: ['socket'],
    data: () => ({ view: null }),
    created() {
      this.socket.on('state', (sent) => (this.view = sent));
    },
    render() {
      if (this.view?.phase === 'scoring') throw new Error('cannot draw the scores');
      return h('main', 'fine');
    },
  };
  const result = await walkViews(Broken, [view('lobby'), view('scoring')]);
  assert.ok(result.problems.length >= 1, 'the crash was collected');
  assert.ok(result.problems.some((problem) => problem.includes('cannot draw the scores')), result.problems.join('\n'));
});

test('a table that cannot even be mounted is reported the same way', async () => {
  const Broken = {
    setup() {
      throw new Error('fell over at the start');
    },
    render: () => h('main'),
  };
  let result;
  await assert.doesNotReject(async () => (result = await walkViews(Broken, [view('lobby')])));
  assert.ok(result.problems.some((problem) => problem.includes('fell over at the start')), result.problems.join('\n'));
});

test('a Vue warning is a problem: a property read in the template that is not there', async () => {
  const Careless = {
    props: ['socket'],
    render() {
      return h('main', String(this.noSuchThing));
    },
  };
  const result = await walkViews(Careless, [view('lobby')]);
  assert.ok(result.problems.some((problem) => problem.startsWith('warn:') && problem.includes('noSuchThing')), result.problems.join('\n'));
});

test('anything a table writes to the console as a warning or an error is a problem', async () => {
  const Noisy = {
    props: ['socket'],
    created() {
      this.socket.on('state', (sent) => {
        if (sent.phase === 'lobby') console.warn('a warning about', sent.phase);
        else console.error('an error about', sent.phase);
      });
    },
    render: () => h('main', 'fine'),
  };
  const result = await walkViews(Noisy, [view('lobby'), view('playing')]);
  assert.deepEqual(result.problems, ['warn: a warning about lobby', 'error: an error about playing']);
  assert.equal(result.sent, 2);
});

test('the console is put back afterwards, whether the walk went well or badly', async () => {
  const before = { warn: console.warn, error: console.error };
  await walkViews(recorder({}), [view('lobby')]);
  assert.equal(console.warn, before.warn);
  assert.equal(console.error, before.error);
  await walkViews({ setup() { throw new Error('no'); }, render: () => h('main') }, [view('lobby')]);
  assert.equal(console.warn, before.warn);
  assert.equal(console.error, before.error);
  await walkViews(recorder({}), ['{ this is not JSON']);
  assert.equal(console.warn, before.warn);
  assert.equal(console.error, before.error);
});

test('a recorded view that cannot be read is a problem, not a crash', async () => {
  let result;
  await assert.doesNotReject(async () => (result = await walkViews(recorder({}), [view('lobby'), '{ this is not JSON'])));
  assert.equal(result.sent, 1);
  assert.ok(result.problems.length >= 1 && result.problems.every((problem) => problem.startsWith('thrown:')), result.problems.join('\n'));
});

test('the component is taken down afterwards', async () => {
  let unmounted = 0;
  const Tidy = { props: ['socket'], unmounted: () => unmounted++, render: () => h('main', 'fine') };
  await walkViews(Tidy, [view('lobby')]);
  assert.equal(unmounted, 1);
});
