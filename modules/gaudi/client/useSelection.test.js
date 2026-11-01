import { describe, expect, it } from 'vitest';
import { computed, nextTick, reactive } from 'vue';
import { useSelection } from './useSelection.js';

/** A fake view with a pool of two dice, in the middle of round 1. */
const makeView = () => reactive({ round: 1, turnIndex: 0, phase: 'playing', turn: { extra: false }, pool: [{ id: 1, v: 3 }, { id: 2, v: 4 }] });
/** Sets the selection up over a view; poolDie looks dice up in the view's pool. */
function setup(view) {
  const s = computed(() => view);
  const poolDie = (id) => view.pool.find((d) => d.id === id) ?? null;
  return useSelection(s, poolDie);
}

describe('useSelection', () => {
  it('starts with nothing selected', () => {
    const sel = setup(makeView());
    expect(sel.selected.value).toBeNull();
    expect(sel.mode.value).toBeNull();
    expect(sel.message.value).toBe('');
  });

  it('clears the selection, the tool and the message when the turn index moves on', async () => {
    const view = makeView();
    const sel = setup(view);
    sel.selected.value = 1;
    sel.mode.value = { id: 'mirror', die: 2 };
    sel.message.value = 'Careful.';
    view.turnIndex = 1;
    await nextTick();
    expect(sel.selected.value).toBeNull();
    expect(sel.mode.value).toBeNull();
    expect(sel.message.value).toBe('');
  });

  it('clears everything when only the extra flag changes (Swift Hand: same round, turn index and phase)', async () => {
    const view = makeView();
    const sel = setup(view);
    sel.selected.value = 1;
    sel.mode.value = { id: 'mirror', die: 2 };
    view.turn.extra = true;
    await nextTick();
    expect(sel.selected.value).toBeNull();
    expect(sel.mode.value).toBeNull();
    view.turn.extra = false; // and back to normal is a new key again
    sel.selected.value = 2;
    await nextTick();
    expect(sel.selected.value).toBeNull();
  });

  it('drops a selected die, and a tool die, that have left the pool, but keeps the others', async () => {
    const view = makeView();
    const sel = setup(view);
    sel.selected.value = 1;
    sel.mode.value = { id: 'mirror', die: 2 };
    view.pool = [{ id: 2, v: 4 }];
    await nextTick();
    expect(sel.selected.value).toBeNull();
    expect(sel.mode.value.die).toBe(2);
    view.pool = [];
    await nextTick();
    expect(sel.mode.value.die).toBeNull();
  });

  it('clear() drops the selection and the tool but not the message', () => {
    const sel = setup(makeView());
    sel.selected.value = 1;
    sel.mode.value = { id: 'kiln' };
    sel.message.value = 'Hello';
    sel.clear();
    expect(sel.selected.value).toBeNull();
    expect(sel.mode.value).toBeNull();
    expect(sel.message.value).toBe('Hello');
  });
});
