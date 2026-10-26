import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerPopup from './PlayerPopup.vue';

let wrapper;
afterEach(() => wrapper?.unmount());

const person = { id: 2, name: 'Bob', bot: false, away: false, isHost: false };
function make(props = {}, slots = {}) {
  wrapper = mount(PlayerPopup, { props: { player: person, ...props }, slots });
  return wrapper;
}
const removeButton = () => wrapper.findAll('button').find((b) => /^Remove/.test(b.text()));

describe('PlayerPopup', () => {
  it('shows who the player is and whether they are connected', () => {
    make();
    expect(wrapper.text()).toContain('Bob');
    expect(wrapper.text()).toContain('connected');
    expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe("Bob's details");
    expect(wrapper.find('.bot-icon').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('host');
  });

  it('says when the player is away, is the host, or is a computer player', async () => {
    make({ player: { ...person, away: true, isHost: true } });
    expect(wrapper.text()).toContain('away');
    expect(wrapper.text()).toContain('host');
    await wrapper.setProps({ player: { ...person, bot: true } });
    expect(wrapper.find('.bot-icon').exists()).toBe(true);
    expect(wrapper.text()).toContain('computer');
  });

  it('draws the game panel from the default slot, and nothing when there is none', () => {
    make({}, { default: '<p class="mine">3 tiles</p>' });
    expect(wrapper.find('.panel .mine').text()).toBe('3 tiles');
    wrapper.unmount();
    make();
    expect(wrapper.find('.panel').exists()).toBe(false);
  });

  it('offers no remove button unless the viewer can remove', () => {
    make({ canRemove: false });
    expect(removeButton()).toBeUndefined();
  });

  it('removes a person after an inline confirmation, and Cancel backs out', async () => {
    make({ canRemove: true });
    expect(removeButton().text()).toBe('Remove player');
    await removeButton().trigger('click');
    expect(wrapper.emitted('remove')).toBeUndefined();
    expect(wrapper.text()).toContain('Remove Bob from the game?');
    await wrapper.findAll('button').find((b) => b.text() === 'Cancel').trigger('click');
    expect(removeButton().text()).toBe('Remove player');
    await removeButton().trigger('click');
    await wrapper.find('[data-confirm]').trigger('click');
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('calls the button "Remove computer player" for a computer player, and always offers it', () => {
    make({ canRemove: true, player: { ...person, bot: true } });
    expect(removeButton().text()).toBe('Remove computer player');
  });

  it('shows the reason a removal was refused, back at the plain button', async () => {
    make({ canRemove: true });
    await removeButton().trigger('click');
    await wrapper.setProps({ error: 'Nope.' });
    expect(wrapper.text()).toContain('Nope.');
    expect(removeButton().text()).toBe('Remove player');
  });

  it('starts the confirmation again for another player', async () => {
    make({ canRemove: true });
    await removeButton().trigger('click');
    await wrapper.setProps({ player: { ...person, id: 3, name: 'Cat' } });
    expect(removeButton().text()).toBe('Remove player');
  });
});
