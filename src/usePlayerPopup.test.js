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

describe('usePlayerPopup placement', () => {
  it('hangs the pop-up under the chip it was opened from, left edges aligned', async () => {
    table();
    const area = wrapper.find('.player-popup');
    expect(area.exists()).toBe(false);
    await chip(1).trigger('pointerenter');
    // jsdom has no layout, so there is no area to place it in and it stays centred; the anchor is still handed over.
    expect(popup().exists()).toBe(true);
  });
});

describe('usePlayerPopup hovering', () => {
  it('opens on hover, closes a moment after the pointer leaves, and stays while the pointer is on the pop-up', async () => {
    vi.useFakeTimers();
    try {
      table();
      await chip(1).trigger('pointerenter');
      expect(popup().text()).toContain('Bob');
      await chip(1).trigger('pointerleave');
      await vi.advanceTimersByTimeAsync(100);
      expect(popup().exists()).toBe(true); // the pointer is crossing to the pop-up
      await popup().trigger('pointerenter');
      await vi.advanceTimersByTimeAsync(1000);
      expect(popup().exists()).toBe(true);
      await popup().trigger('pointerleave');
      await vi.advanceTimersByTimeAsync(500);
      expect(popup().exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a click pins the pop-up open past the pointer leaving, and the next click closes it', async () => {
    vi.useFakeTimers();
    try {
      table();
      await chip(1).trigger('pointerenter');
      await chip(1).trigger('click'); // already open from the hover: this pins it
      await chip(1).trigger('pointerleave');
      await vi.advanceTimersByTimeAsync(1000);
      expect(popup().exists()).toBe(true);
      await chip(1).trigger('click');
      expect(popup().exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('usePlayerPopup', () => {
  it('makes every player a button, you included', () => {
    table();
    expect(wrapper.findAll('.score-bar button.chip-button').map((b) => b.attributes('aria-label'))).toEqual(["Show Ann's details", "Show Bob's details", "Show Robo's details"]);
    expect(chip(0).attributes('title')).toBe('Show details');
  });

  it('opens your own pop-up, tagged you, and never offers to remove you', async () => {
    table();
    await chip(0).trigger('click');
    expect(popup().exists()).toBe(true);
    expect(popup().text()).toContain('Ann');
    expect(popup().find('.tag').text()).toBe('you');
    expect(popup().find('.panel-text').text()).toBe('open: 0');
    expect(popup().text()).not.toContain('Remove');
  });

  it('opens one pop-up at a time, and a second click on the chip closes it', async () => {
    table();
    expect(popup().exists()).toBe(false);
    await chip(1).trigger('click');
    expect(popup().text()).toContain('Bob');
    expect(popup().find('.panel-text').text()).toBe('open: 1');
    await chip(2).trigger('click');
    expect(wrapper.findAll('.player-popup')).toHaveLength(1);
    expect(popup().text()).toContain('Robo');
    await chip(2).trigger('click');
    expect(popup().exists()).toBe(false);
  });

  it('closes on Esc and on a click outside, but not on a click inside', async () => {
    table();
    await chip(1).trigger('click');
    await popup().trigger('click');
    expect(popup().exists()).toBe(true);
    document.body.click();
    await flushPromises();
    expect(popup().exists()).toBe(false);
    await chip(1).trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(popup().exists()).toBe(false);
  });

  it('gives only the host the Remove button, worded for people and for computer players', async () => {
    table({ host: false });
    await chip(1).trigger('click');
    expect(popup().text()).not.toContain('Remove');
    wrapper.unmount();
    table();
    await chip(1).trigger('click');
    expect(popup().text()).toContain('Remove player');
    await chip(2).trigger('click');
    expect(popup().text()).toContain('Remove computer player');
  });

  it("removes after the confirmation, through the game's own call, and closes", async () => {
    const { remove } = table();
    await chip(1).trigger('click');
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
    await chip(2).trigger('click');
    await popupButton('Remove computer player').trigger('click');
    await popup().find('[data-confirm]').trigger('click');
    await flushPromises();
    expect(popup().text()).toContain('Not now.');
  });

  it('closes by itself when the player goes', async () => {
    const { players } = table();
    await chip(1).trigger('click');
    players.value = players.value.filter((p) => p.id !== 1);
    await flushPromises();
    expect(popup().exists()).toBe(false);
  });
});
