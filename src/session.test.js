import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api, applyBackground, backgroundCss, cardBackCss, changePassword, loadSession, register, safeNext, session, signIn, signOut,
  updateProfile, uploadBackground, uploadCardBack,
} from './session.js';

const PRESETS = { night: 'night-image', dawn: 'dawn-image' };
const BACKS = { crimson: 'crimson-back', navy: 'navy-back' };

function reply(body, status = 200, { json = true } = {}) {
  const text = json ? JSON.stringify(body) : body;
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

const root = () => document.documentElement.style;
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(session, { ready: false, user: null, games: [], presets: PRESETS, cardBacks: BACKS });
  root().removeProperty('--site-bg');
  root().removeProperty('--card-back');
});
afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('sends a bodyless request without a content type', async () => {
    fetchMock.mockResolvedValue(reply({ a: 1 }));
    expect(await api('GET', '/x')).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/x', { method: 'GET', headers: {} });
  });

  it('sends a JSON body with a content type', async () => {
    fetchMock.mockResolvedValue(reply({}));
    await api('POST', '/x', { b: 2 });
    expect(fetchMock).toHaveBeenCalledWith('/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"b":2}' });
  });

  it('throws the server message from a JSON error body', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Nope.' }, 400));
    await expect(api('GET', '/x')).rejects.toThrow('Nope.');
  });

  it('falls back to a generic message when the JSON has no error', async () => {
    fetchMock.mockResolvedValue(reply({}, 500));
    await expect(api('GET', '/x')).rejects.toThrow('Something went wrong (500).');
  });

  it('falls back to a generic message for a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(reply('<html>Bad gateway</html>', 502, { json: false }));
    await expect(api('GET', '/x')).rejects.toThrow('Something went wrong (502).');
  });

  it('copes with an empty error body', async () => {
    fetchMock.mockResolvedValue(reply('', 503, { json: false }));
    await expect(api('GET', '/x')).rejects.toThrow('Something went wrong (503).');
  });

  it('returns the raw text when a successful body is not JSON', async () => {
    fetchMock.mockResolvedValue(reply('plain', 200, { json: false }));
    expect(await api('GET', '/x')).toBe('plain');
  });
});

describe('safeNext()', () => {
  it.each([
    ['/play/dixnt?boss-aware-you', '/play/dixnt?boss-aware-you'],
    ['/', '/'],
    ['/stats', '/stats'],
    ['//evil.example', '/'],
    ['///evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['stats', '/'],
    ['', '/'],
    [undefined, '/'],
    [['/a'], '/'],
    [null, '/'],
  ])('%j -> %j', (input, expected) => expect(safeNext(input)).toBe(expected));
});

describe('backgroundCss()', () => {
  it('uses the preset image', () => expect(backgroundCss({ type: 'preset', value: 'dawn' })).toBe('dawn-image'));
  it('falls back to night for an unknown preset', () => expect(backgroundCss({ type: 'preset', value: 'nope' })).toBe('night-image'));
  it('makes a flat colour a gradient of one colour', () => {
    expect(backgroundCss({ type: 'colour', value: '#112233' })).toBe('linear-gradient(#112233, #112233)');
  });
  it('builds a gradient with its angle', () => {
    expect(backgroundCss({ type: 'gradient', from: '#111', to: '#222', angle: 45 })).toBe('linear-gradient(45deg, #111, #222)');
  });
  it('wraps an uploaded image in a dimming layer and encodes the file name', () => {
    const css = backgroundCss({ type: 'image', file: 'a b/c.png' });
    expect(css).toContain('url(/uploads/a%20b%2Fc.png)');
    expect(css).toContain('rgb(0 0 0 / 0.25)');
  });
  it.each([[undefined], [null], [{}], [{ type: 'mystery' }], ['junk']])('falls back to night for %j', (value) => {
    expect(backgroundCss(value)).toBe('night-image');
  });
  it('returns an empty string when there is no night preset at all', () => expect(backgroundCss(null, {})).toBe(''));
  it('defaults to the session presets', () => {
    session.presets = { night: 'other-night' };
    expect(backgroundCss(null)).toBe('other-night');
  });
});

describe('cardBackCss()', () => {
  it('uses the chosen preset', () => expect(cardBackCss({ type: 'preset', value: 'navy' })).toBe('navy-back'));
  it('falls back to crimson for an unknown preset', () => expect(cardBackCss({ type: 'preset', value: 'nope' })).toBe('crimson-back'));
  it('covers an uploaded image', () => {
    expect(cardBackCss({ type: 'image', file: 'x y.png' })).toBe('url(/uploads/x%20y.png) center / cover no-repeat');
  });
  it.each([[undefined], [null], [{}]])('falls back to crimson for %j', (value) => expect(cardBackCss(value)).toBe('crimson-back'));
  it('uses a hard-coded colour when there are no presets', () => expect(cardBackCss(null, {})).toBe('#6b1a27'));
});

describe('applyBackground()', () => {
  it('sets --site-bg', () => {
    applyBackground({ type: 'colour', value: '#abcdef' });
    expect(root().getPropertyValue('--site-bg')).toBe('linear-gradient(#abcdef, #abcdef)');
  });
});

const USER = { id: 1, username: 'ann', displayName: 'Ann', background: { type: 'preset', value: 'dawn' }, cardBack: { type: 'preset', value: 'navy' } };

describe('loadSession()', () => {
  it('loads config and the signed-in user, then applies the CSS variables', async () => {
    fetchMock.mockImplementation(async (url) =>
      url === '/api/config' ? reply({ games: [{ id: 'g' }], backgrounds: PRESETS, cardBacks: BACKS }) : reply({ user: USER }),
    );
    await loadSession();
    expect(session).toMatchObject({ ready: true, user: USER, games: [{ id: 'g' }], presets: PRESETS, cardBacks: BACKS });
    expect(root().getPropertyValue('--site-bg')).toBe('dawn-image');
    expect(root().getPropertyValue('--card-back')).toBe('navy-back');
  });

  it('handles a signed-out visitor with the default look', async () => {
    fetchMock.mockImplementation(async (url) =>
      url === '/api/config' ? reply({ games: [], backgrounds: PRESETS, cardBacks: BACKS }) : reply({ user: null }),
    );
    await loadSession();
    expect(session.user).toBeNull();
    expect(session.ready).toBe(true);
    expect(root().getPropertyValue('--site-bg')).toBe('night-image');
    expect(root().getPropertyValue('--card-back')).toBe('crimson-back');
  });

  it('still becomes ready when the server is down, and rethrows', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'down' }, 500));
    await expect(loadSession()).rejects.toThrow('down');
    expect(session.ready).toBe(true);
    expect(session.user).toBeNull();
  });
});

describe('account actions', () => {
  const lastCall = () => fetchMock.mock.calls.at(-1);

  it('signIn posts the credentials and stores the user', async () => {
    fetchMock.mockResolvedValue(reply({ user: USER }));
    await signIn('ann', 'secret');
    const [url, options] = lastCall();
    expect(url).toBe('/api/auth/login');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ username: 'ann', password: 'secret' });
    expect(session.user).toEqual(USER);
    expect(root().getPropertyValue('--site-bg')).toBe('dawn-image');
    expect(root().getPropertyValue('--card-back')).toBe('navy-back');
  });

  it('marks the page with the animations choice: on, off, or auto (follow the device) when none was made', async () => {
    for (const [choice, mark] of [[false, 'off'], [true, 'on'], [null, 'auto'], [undefined, 'auto']]) {
      fetchMock.mockResolvedValue(reply({ user: { ...USER, playAnimations: choice } }));
      await signIn('ann', 'secret');
      expect(document.documentElement.dataset.animations, String(choice)).toBe(mark);
    }
  });

  it('signIn leaves the user alone and rejects on a bad password', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Wrong password.' }, 401));
    await expect(signIn('ann', 'bad')).rejects.toThrow('Wrong password.');
    expect(session.user).toBeNull();
  });

  it('register posts the display name too', async () => {
    fetchMock.mockResolvedValue(reply({ user: USER }));
    await register('ann', 'secret12', 'Ann');
    const [url, options] = lastCall();
    expect(url).toBe('/api/auth/register');
    expect(JSON.parse(options.body)).toEqual({ username: 'ann', password: 'secret12', displayName: 'Ann' });
    expect(session.user).toEqual(USER);
  });

  it('signOut posts to logout and resets the look', async () => {
    session.user = USER;
    fetchMock.mockResolvedValue(reply({}));
    await signOut();
    expect(lastCall()[0]).toBe('/api/auth/logout');
    expect(session.user).toBeNull();
    expect(root().getPropertyValue('--site-bg')).toBe('night-image');
    expect(root().getPropertyValue('--card-back')).toBe('crimson-back');
  });

  it('updateProfile PATCHes the changes and applies the new background', async () => {
    const updated = { ...USER, background: { type: 'colour', value: '#010203' } };
    fetchMock.mockResolvedValue(reply({ user: updated }));
    await updateProfile({ background: updated.background });
    const [url, options] = lastCall();
    expect(url).toBe('/api/me');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ background: updated.background });
    expect(session.user).toEqual(updated);
    expect(root().getPropertyValue('--site-bg')).toBe('linear-gradient(#010203, #010203)');
  });

  it('changePassword posts both passwords', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true }));
    await changePassword('old', 'newnewnew');
    const [url, options] = lastCall();
    expect(url).toBe('/api/me/password');
    expect(JSON.parse(options.body)).toEqual({ currentPassword: 'old', newPassword: 'newnewnew' });
  });

  describe.each([
    ['uploadBackground', uploadBackground, '/api/me/background-image', 'background', 'bg.png', '--site-bg'],
    ['uploadCardBack', uploadCardBack, '/api/me/card-back-image', 'cardBack', 'back.png', '--card-back'],
  ])('%s', (_name, fn, url, key, fileName, variable) => {
    const file = () => new File(['x'], 'p.png', { type: 'image/png' });

    it('sends the file with its content type and stores the returned user', async () => {
      const image = { type: 'image', file: fileName };
      fetchMock.mockResolvedValue(reply({ user: { ...USER, [key]: image } }));
      const f = file();
      await fn(f);
      const [calledUrl, options] = lastCall();
      expect(calledUrl).toBe(url);
      expect(options).toEqual({ method: 'POST', headers: { 'content-type': 'image/png' }, body: f });
      expect(session.user[key]).toEqual(image);
      expect(root().getPropertyValue(variable)).toContain(fileName);
    });

    it('throws the server message on failure and keeps the user', async () => {
      fetchMock.mockResolvedValue(reply({ error: 'Too big.' }, 413));
      await expect(fn(file())).rejects.toThrow('Too big.');
      expect(session.user).toBeNull();
    });

    it('throws a generic message when the error body is not JSON', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new SyntaxError('bad')) });
      await expect(fn(file())).rejects.toThrow('Could not upload that image.');
    });
  });
});
