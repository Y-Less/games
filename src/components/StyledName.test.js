import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { clearProfiles } from '../profiles.js';
import { session } from '../session.js';
import StyledName from './StyledName.vue';

let wrapper;
let fetched;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  clearProfiles();
  session.user = { id: 1, displayName: 'Me', nameStyle: { style: 'gold' } };
  fetched = [];
  globalThis.fetch = vi.fn(async (url) => {
    fetched.push(url);
    const ids = new URL(url, 'http://x').searchParams.get('ids').split(',').map(Number);
    const players = Object.fromEntries(ids.filter((id) => id === 2).map((id) => [id, { displayName: 'Bob', nameStyle: { style: 'ruby' } }]));
    return { ok: true, text: async () => JSON.stringify({ players }) };
  });
});
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});

const settle = async () => {
  await vi.advanceTimersByTimeAsync(50);
  await flushPromises();
};

describe('StyledName', () => {
  it('shows a name with no user, such as a computer player, as plain text and asks for nothing', async () => {
    wrapper = mount(StyledName, { props: { name: 'Robo' } });
    await settle();
    expect(wrapper.text()).toBe('Robo');
    expect(wrapper.classes()).not.toContain('styled');
    expect(fetched).toEqual([]);
  });

  it('draws your own style from the session, without asking the server', async () => {
    wrapper = mount(StyledName, { props: { name: 'Me', userId: 1 } });
    await settle();
    expect(wrapper.classes()).toContain('styled');
    expect(wrapper.attributes('data-name-style')).toBe('gold');
    expect(wrapper.attributes('style')).toContain('--ns-border');
    expect(fetched).toEqual([]);
    session.user = { ...session.user, nameStyle: { style: 'plain' } };
    await flushPromises();
    expect(wrapper.classes()).not.toContain('styled');
  });

  it("fetches another player's style once, for everyone who asks in the same moment", async () => {
    wrapper = mount({ components: { StyledName }, template: '<div><StyledName name="Bob" :user-id="2" /><StyledName name="Bob again" :user-id="2" /><StyledName name="Cat" :user-id="3" /></div>' });
    expect(wrapper.findAll('.styled')).toHaveLength(0); // plain until it arrives
    await settle();
    expect(fetched).toEqual(['/api/players?ids=2,3']);
    const styled = wrapper.findAll('.styled');
    expect(styled.map((n) => n.text())).toEqual(['Bob', 'Bob again']);
    expect(styled[0].attributes('data-name-style')).toBe('ruby');
    expect(wrapper.text()).toContain('Cat'); // someone unknown stays plain
  });

  it('stays plain, and keeps the name, when the server cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    });
    wrapper = mount(StyledName, { props: { name: 'Bob', userId: 2 } });
    await settle();
    expect(wrapper.text()).toBe('Bob');
    expect(wrapper.classes()).not.toContain('styled');
  });

  it('treats an unknown style id as plain', async () => {
    session.user = { id: 1, nameStyle: { style: 'does-not-exist' } };
    wrapper = mount(StyledName, { props: { name: 'Me', userId: 1 } });
    expect(wrapper.classes()).not.toContain('styled');
  });
  it('animates the border when the player has an animation, even on a plain name', async () => {
    wrapper = mount(StyledName, { props: { name: 'Anim', styleId: 'plain', animationId: 'glow' } });
    expect(wrapper.attributes('data-animation')).toBe('glow');
    expect(wrapper.classes()).toContain('styled');
    expect(wrapper.attributes('style')).toContain('--ns-glow');
  });

  it('is still by default', () => {
    wrapper = mount(StyledName, { props: { name: 'Still', styleId: 'ruby' } });
    expect(wrapper.attributes('data-animation')).toBe('none');
  });
});

describe('the newer name animations', () => {
  it('wears Neon flicker and Northern lights as an animation, even on a plain name', () => {
    for (const animationId of ['neon', 'aurora']) {
      wrapper = mount(StyledName, { props: { name: 'Zed', animationId } });
      expect(wrapper.attributes('data-animation')).toBe(animationId);
      expect(wrapper.classes()).toContain('styled');
      wrapper.unmount();
    }
  });
});
