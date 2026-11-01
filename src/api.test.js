import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, onUnauthorised, uploadImage } from './api.js';

const reply = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });

describe('api', () => {
  let gone;
  beforeEach(() => {
    gone = vi.fn();
    onUnauthorised(gone);
  });
  afterEach(() => onUnauthorised(() => {}));

  it('returns the parsed reply and sends JSON bodies', async () => {
    globalThis.fetch = vi.fn(async () => reply({ user: { id: 1 } }));
    expect(await api('PATCH', '/api/me', { displayName: 'Ann' })).toEqual({ user: { id: 1 } });
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.method).toBe('PATCH');
    expect(options.headers['content-type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ displayName: 'Ann' });
    expect(gone).not.toHaveBeenCalled();
  });

  it('throws the server\'s message on failure, and a generic one when there is none', async () => {
    globalThis.fetch = vi.fn(async () => reply({ error: 'No such game.' }, 404));
    await expect(api('GET', '/api/x')).rejects.toThrow('No such game.');
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'not json' }));
    await expect(api('GET', '/api/x')).rejects.toThrow('Something went wrong (500).');
    expect(gone).not.toHaveBeenCalled();
  });

  it('tells the session when the server says the user is not signed in', async () => {
    globalThis.fetch = vi.fn(async () => reply({ error: 'Please sign in.' }, 401));
    await expect(api('GET', '/api/me')).rejects.toThrow('Please sign in.');
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('uploads a picture as it is', async () => {
    globalThis.fetch = vi.fn(async () => reply({ user: { id: 1 } }));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(await uploadImage('/api/me/background-image', file)).toEqual({ user: { id: 1 } });
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers['content-type']).toBe('image/png');
    expect(options.body).toBe(file);
  });
});
