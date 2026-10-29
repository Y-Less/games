import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { session } from '../session.js';
import ProfileView from './ProfileView.vue';

function reply(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => body };
}

const PRESETS = { night: 'night-img', dawn: 'dawn-img' };
const BACKS = { crimson: 'crimson-bg', navy: 'navy-bg' };
const baseUser = () => ({
  id: 1, username: 'ann', displayName: 'Ann', background: { type: 'preset', value: 'night' }, cardBack: { type: 'preset', value: 'crimson' },
});

let fetchMock;
let wrapper;
let currentUser;

/** Echoes the PATCH back as the updated user, the way the server does. */
function serve() {
  fetchMock.mockImplementation(async (url, options) => {
    if (url === '/api/me' && options.method === 'PATCH') {
      currentUser = { ...currentUser, ...JSON.parse(options.body) };
      return reply({ user: currentUser });
    }
    if (url.startsWith('/api/me/') && url.endsWith('-image')) {
      const key = url.includes('background') ? 'background' : 'cardBack';
      currentUser = { ...currentUser, [key]: { type: 'image', file: 'up.png' } };
      return reply({ user: currentUser });
    }
    if (url === '/api/me/password') return reply({ ok: true });
    return reply({ error: 'unexpected' }, 404);
  });
}

function make(user = baseUser()) {
  currentUser = user;
  Object.assign(session, { user, presets: PRESETS, cardBacks: BACKS });
  wrapper = mount(ProfileView);
  return wrapper;
}

const lastCall = () => fetchMock.mock.calls.at(-1);
const lastBody = () => JSON.parse(lastCall()[1].body);
const status = () => wrapper.find('[role="status"]');
const alert = () => wrapper.find('[role="alert"]');

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  serve();
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

describe('ProfileView name', () => {
  it('prefills the display name and shows the username', () => {
    const w = make();
    expect(w.find('input[aria-label="Display name"]').element.value).toBe('Ann');
    expect(w.text()).toContain('Signed in as ann');
  });

  it('disables Save until the name changes to something non-blank', async () => {
    const w = make();
    const save = () => w.find('form button');
    const input = w.find('input[aria-label="Display name"]');
    expect(save().attributes('disabled')).toBeDefined();
    await input.setValue('   ');
    expect(save().attributes('disabled')).toBeDefined();
    await input.setValue(' Ann ');
    expect(save().attributes('disabled')).toBeDefined();
    await input.setValue('Annie');
    expect(save().attributes('disabled')).toBeUndefined();
  });

  it('saves the name with a PATCH and confirms', async () => {
    const w = make();
    await w.find('input[aria-label="Display name"]').setValue('Annie');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(lastCall()[0]).toBe('/api/me');
    expect(lastCall()[1].method).toBe('PATCH');
    expect(lastBody()).toEqual({ displayName: 'Annie' });
    expect(session.user.displayName).toBe('Annie');
    expect(status().text()).toBe('Name saved.');
  });

  it('shows the server error when saving fails', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'That name is taken.' }, 409));
    const w = make();
    await w.find('input[aria-label="Display name"]').setValue('Bob');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(alert().text()).toBe('That name is taken.');
    expect(status().exists()).toBe(false);
  });

  it('replaces an old message with the next outcome', async () => {
    const w = make();
    await w.find('input[aria-label="Display name"]').setValue('Annie');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(status().exists()).toBe(true);
    fetchMock.mockResolvedValue(reply({ error: 'Boom.' }, 500));
    await w.find('input[aria-label="Display name"]').setValue('Other');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(status().exists()).toBe(false);
    expect(alert().text()).toBe('Boom.');
  });
});

describe('ProfileView background', () => {
  it('shows a swatch per preset and marks the current one', () => {
    const w = make();
    const swatches = w.findAll('button.swatch');
    expect(swatches.map((s) => s.attributes('aria-label'))).toEqual(['night background', 'dawn background']);
    expect(swatches.map((s) => s.attributes('aria-pressed'))).toEqual(['true', 'false']);
    expect(swatches.map((s) => s.classes('chosen'))).toEqual([true, false]);
  });

  it('sends a preset choice', async () => {
    const w = make();
    await w.find('button[aria-label="dawn background"]').trigger('click');
    await flushPromises();
    expect(lastBody()).toEqual({ background: { type: 'preset', value: 'dawn' } });
    expect(status().text()).toBe('Background saved.');
    expect(w.find('button[aria-label="dawn background"]').attributes('aria-pressed')).toBe('true');
  });

  it('sends the chosen colour', async () => {
    const w = make();
    await w.find('input[aria-label="Background colour"]').setValue('#ff8800');
    await w.findAll('button').find((b) => b.text() === 'Use this colour').trigger('click');
    await flushPromises();
    expect(lastBody()).toEqual({ background: { type: 'colour', value: '#ff8800' } });
  });

  it('starts the colour picker from the current colour', () => {
    const w = make({ ...baseUser(), background: { type: 'colour', value: '#123456' } });
    expect(w.find('input[aria-label="Background colour"]').element.value).toBe('#123456');
  });

  it('sends a gradient with both colours and the angle as a number', async () => {
    const w = make();
    await w.find('input[aria-label="Gradient start"]').setValue('#111111');
    await w.find('input[aria-label="Gradient end"]').setValue('#222222');
    await w.find('input[type="range"]').setValue('90');
    await w.findAll('button').find((b) => b.text() === 'Use this gradient').trigger('click');
    await flushPromises();
    expect(lastBody()).toEqual({ background: { type: 'gradient', from: '#111111', to: '#222222', angle: 90 } });
  });

  it('starts the gradient controls from the current gradient', async () => {
    const w = make({ ...baseUser(), background: { type: 'gradient', from: '#0a0a0a', to: '#0b0b0b', angle: 33 } });
    expect(w.find('input[aria-label="Gradient start"]').element.value).toBe('#0a0a0a');
    expect(w.find('input[aria-label="Gradient end"]').element.value).toBe('#0b0b0b');
    expect(w.find('input[type="range"]').element.value).toBe('33');
  });

  it('shows a background error', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Not allowed.' }, 403));
    const w = make();
    await w.find('button[aria-label="dawn background"]').trigger('click');
    await flushPromises();
    expect(alert().text()).toBe('Not allowed.');
  });
});

function pick(input, file) {
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  return input.trigger('change');
}

describe('ProfileView uploads', () => {
  it('uploads a background picture with its content type', async () => {
    const w = make();
    const file = new File(['png'], 'sky.png', { type: 'image/png' });
    await pick(w.find('input[aria-label="Upload a background picture"]'), file);
    await flushPromises();
    expect(lastCall()[0]).toBe('/api/me/background-image');
    expect(lastCall()[1]).toEqual({ method: 'POST', headers: { 'content-type': 'image/png' }, body: file });
    expect(status().text()).toBe('Background saved.');
    expect(session.user.background).toEqual({ type: 'image', file: 'up.png' });
  });

  it('uploads a card back with its content type', async () => {
    const w = make();
    const file = new File(['jpg'], 'back.jpg', { type: 'image/jpeg' });
    await pick(w.find('input[aria-label="Upload a card back picture"]'), file);
    await flushPromises();
    expect(lastCall()[0]).toBe('/api/me/card-back-image');
    expect(lastCall()[1].headers).toEqual({ 'content-type': 'image/jpeg' });
    expect(lastCall()[1].body).toBe(file);
    expect(status().text()).toBe('Card back saved.');
  });

  it('does nothing when the file chooser is cancelled', async () => {
    const w = make();
    const input = w.find('input[aria-label="Upload a background picture"]');
    Object.defineProperty(input.element, 'files', { value: [], configurable: true });
    await input.trigger('change');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server error when an upload is rejected', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'That picture is too big.' }, 413));
    const w = make();
    await pick(w.find('input[aria-label="Upload a background picture"]'), new File(['x'], 'big.png', { type: 'image/png' }));
    await flushPromises();
    expect(alert().text()).toBe('That picture is too big.');
  });
});

describe('ProfileView card back', () => {
  it('shows a swatch per card back and marks the current one', () => {
    const w = make();
    const backs = w.findAll('button.back');
    expect(backs.map((b) => b.attributes('aria-label'))).toEqual(['crimson card back', 'navy card back']);
    expect(backs.map((b) => b.attributes('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('sends a card back choice', async () => {
    const w = make();
    await w.find('button[aria-label="navy card back"]').trigger('click');
    await flushPromises();
    expect(lastBody()).toEqual({ cardBack: { type: 'preset', value: 'navy' } });
    expect(status().text()).toBe('Card back saved.');
  });

  it('shows the uploaded picture as the chosen card back', () => {
    const none = make();
    expect(none.find('span.back').exists()).toBe(false);
    none.unmount();
    const w = make({ ...baseUser(), cardBack: { type: 'image', file: 'mine.png' } });
    expect(w.find('span.back.chosen').attributes('title')).toBe('Your picture');
    expect(w.findAll('button.back').some((b) => b.classes('chosen'))).toBe(false);
  });
});

describe('ProfileView password', () => {
  const form = (w) => w.findAll('form')[1];
  const change = (w) => form(w).find('button');

  it('needs a current password and at least 8 characters in the new one', async () => {
    const w = make();
    const old = w.find('input[aria-label="Current password"]');
    const next = w.find('input[aria-label="New password"]');
    expect(change(w).attributes('disabled')).toBeDefined();
    await old.setValue('oldpass');
    await next.setValue('short');
    expect(change(w).attributes('disabled')).toBeDefined();
    await next.setValue('1234567');
    expect(change(w).attributes('disabled')).toBeDefined();
    await next.setValue('12345678');
    expect(change(w).attributes('disabled')).toBeUndefined();
    await old.setValue('');
    expect(change(w).attributes('disabled')).toBeDefined();
  });

  it('posts both passwords, clears the fields and confirms', async () => {
    const w = make();
    await w.find('input[aria-label="Current password"]').setValue('oldpass');
    await w.find('input[aria-label="New password"]').setValue('brand-new-pass');
    await form(w).trigger('submit');
    await flushPromises();
    expect(lastCall()[0]).toBe('/api/me/password');
    expect(lastBody()).toEqual({ currentPassword: 'oldpass', newPassword: 'brand-new-pass' });
    expect(w.find('input[aria-label="Current password"]').element.value).toBe('');
    expect(w.find('input[aria-label="New password"]').element.value).toBe('');
    expect(status().text()).toBe('Password changed. Your other devices have been signed out.');
  });

  it('keeps the fields and shows the error when the current password is wrong', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Your current password is wrong.' }, 403));
    const w = make();
    await w.find('input[aria-label="Current password"]').setValue('wrong');
    await w.find('input[aria-label="New password"]').setValue('brand-new-pass');
    await form(w).trigger('submit');
    await flushPromises();
    expect(alert().text()).toBe('Your current password is wrong.');
    expect(w.find('input[aria-label="Current password"]').element.value).toBe('wrong');
  });
describe('ProfileView animations', () => {
  it('follows the device by default, and saves always, never and back to the device', async () => {
    const w = make();
    const select = () => w.find('select[aria-label="Play animations"]');
    expect(select().element.value).toBe('auto');
    await select().setValue('off');
    await flushPromises();
    expect(lastBody()).toEqual({ playAnimations: false });
    expect(status().text()).toBe('Animations never play.');
    await select().setValue('on');
    await flushPromises();
    expect(lastBody()).toEqual({ playAnimations: true });
    await select().setValue('auto');
    await flushPromises();
    expect(lastBody()).toEqual({ playAnimations: null });
  });

  it('shows the player\'s saved choice', () => {
    expect(make({ ...baseUser(), playAnimations: false }).find('select[aria-label="Play animations"]').element.value).toBe('off');
  });
});
});
