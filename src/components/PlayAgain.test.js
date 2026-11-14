// The host's "Play again" button: offered to the host alone, and only once the game is over.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayAgain from './PlayAgain.vue';

const show = (state) => mount(PlayAgain, { props: { state } });

describe('the play again button', () => {
  it('is offered to the host once the game is over, and says so when pressed', async () => {
    const wrapper = show({ phase: 'finished', hostId: 1, you: 1 });
    expect(wrapper.find('button').text()).toBe('Play again');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('again')).toHaveLength(1);
  });

  it('is offered after a game that was abandoned as well', () => {
    expect(show({ phase: 'abandoned', hostId: 1, you: 1 }).find('button').exists()).toBe(true);
  });

  it('is not offered to anybody else', () => {
    expect(show({ phase: 'finished', hostId: 1, you: 2 }).find('button').exists()).toBe(false);
  });

  it('is not offered while a game is being played, or in the lobby', () => {
    for (const phase of ['lobby', 'drawing', 'reveal']) expect(show({ phase, hostId: 1, you: 1 }).find('button').exists()).toBe(false);
  });

  it('is not offered by a view that names no host', () => {
    expect(show({ phase: 'finished' }).find('button').exists()).toBe(false);
  });
});
