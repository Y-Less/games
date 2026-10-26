import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import ScoreBoard from './components/ScoreBoard.vue';
import PlayerPopup from './components/PlayerPopup.vue';
import { usePlayerPopup } from './usePlayerPopup.js';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

// A table in miniature: the standard score bar and pop-up, wired together as the games do.
function table({ host = true, remove = vi.fn(() => Promise.resolve({ ok: true })) } = {}) {
  const players = ref([
    { id: 0, name: 'Ann', score: 3, isMe: true },
    { id: 1, name: 'Bob', score: 2 },
    { id: 2, name: 'Robo', score: 1, bot: true },
  ]);
  const Table = defineComponent({
    setup() {
      const { scoreProps, popupProps, openId } = usePlayerPopup({ players: () => players.value, hostId: () => 0, isHost: () => host, remove });
      return () => [
        h(ScoreBoard, { players: players.value, ...scoreProps.value }),
        popupProps.value ? h(PlayerPopup, popupProps.value, { default: () => h('p', { class: 'panel-text' }, `open: ${openId.value}`) }) : null,
      ];
    },
  });
  wrapper = mount(Table, { attachTo: document.body });
  return { players, remove };
}
const chip = (n) => wrapper.findAll('.score-bar button.chip-button')[n];
const popup = () => wrapper.find('.player-popup');
const popupButton = (text) => popup().findAll('button').find((b) => b.text() === text);

describe('usePlayerPopup', () => {
  it('makes every other player a button, and not you', () => {
    table();
    expect(wrapper.findAll('.score-bar button.chip-button').map((b) => b.attributes('aria-label'))).toEqual(["Show Bob's details", "Show Robo's details"]);
    expect(chip(0).attributes('title')).toBe('Show details');
  });

  it('opens one pop-up at a time, and a second click on the chip closes it', async () => {
    table();
    expect(popup().exists()).toBe(false);
    await chip(0).trigger('click');
    expect(popup().text()).toContain('Bob');
    expect(popup().find('.panel-text').text()).toBe('open: 1');
    await chip(1).trigger('click');
    expect(wrapper.findAll('.player-popup')).toHaveLength(1);
    expect(popup().text()).toContain('Robo');
    await chip(1).trigger('click');
    expect(popup().exists()).toBe(false);
  });

  it('closes on Esc and on a click outside, but not on a click inside', async () => {
    table();
    await chip(0).trigger('click');
    await popup().trigger('click');
    expect(popup().exists()).toBe(true);
    document.body.click();
    await flushPromises();
    expect(popup().exists()).toBe(false);
    await chip(0).trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(popup().exists()).toBe(false);
  });

  it('gives only the host the Remove button, worded for people and for computer players', async () => {
    table({ host: false });
    await chip(0).trigger('click');
    expect(popup().text()).not.toContain('Remove');
    wrapper.unmount();
    table();
    await chip(0).trigger('click');
    expect(popup().text()).toContain('Remove player');
    await chip(1).trigger('click');
    expect(popup().text()).toContain('Remove computer player');
  });

  it("removes after the confirmation, through the game's own call, and closes", async () => {
    const { remove } = table();
    await chip(0).trigger('click');
    await popupButton('Remove player').trigger('click');
    expect(popup().exists()).toBe(true); // opening the confirmation does not close it
    expect(remove).not.toHaveBeenCalled();
    await popup().find('[data-confirm]').trigger('click');
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(1, expect.objectContaining({ id: 1, name: 'Bob' }));
    expect(popup().exists()).toBe(false);
  });

  it('keeps the pop-up open with the reason when the server refuses', async () => {
    table({ remove: vi.fn(() => Promise.resolve({ ok: false, error: 'Not now.' })) });
    await chip(1).trigger('click');
    await popupButton('Remove computer player').trigger('click');
    await popup().find('[data-confirm]').trigger('click');
    await flushPromises();
    expect(popup().text()).toContain('Not now.');
  });

  it('closes by itself when the player goes', async () => {
    const { players } = table();
    await chip(0).trigger('click');
    players.value = players.value.filter((p) => p.id !== 1);
    await flushPromises();
    expect(popup().exists()).toBe(false);
  });
});
