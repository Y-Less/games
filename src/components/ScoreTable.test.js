import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ScoreTable from './ScoreTable.vue';

const players = [
  { id: 'a', name: 'Ann', score: 30, isMe: true },
  { id: 'b', name: 'Bob', score: 20 },
  { id: 'c', name: 'Cat', score: 10 },
];
const rounds = [
  { label: 'Hand 1', deltas: { a: 10, b: 5, c: 0 } },
  { label: 'Hand 2', deltas: { a: 20, b: 15, c: 10 }, notes: { c: 'shot the moon' } },
];

const make = (props = {}) => mount(ScoreTable, { props: { players, rounds, ...props } });
const footerCells = (w) => w.findAll('tfoot td');

describe('ScoreTable', () => {
  it('has a header per player and marks me', () => {
    const w = make();
    expect(w.findAll('thead th').map((h) => h.text())).toEqual(['Round', 'Ann (you)', 'Bob', 'Cat']);
  });

  it('renders one row per round with signed points', () => {
    const w = make();
    const rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('th').text()).toBe('Hand 1');
    expect(rows[0].findAll('td').map((c) => c.text())).toEqual(['+10', '+5', '0']);
    expect(rows[1].findAll('td')[0].text()).toBe('+20');
  });

  it('shows no plus sign when low is better', () => {
    const w = make({ lowIsBetter: true });
    expect(w.findAll('tbody tr')[0].findAll('td').map((c) => c.text())).toEqual(['10', '5', '0']);
  });

  it('keeps negative numbers as they are', () => {
    const w = make({ rounds: [{ label: 'R', deltas: { a: -5, b: 0, c: 3 } }] });
    expect(w.findAll('tbody td').map((c) => c.text())).toEqual(['-5', '0', '+3']);
  });

  it('treats a missing delta as zero', () => {
    const w = make({ rounds: [{ label: 'R', deltas: { a: 4 } }] });
    expect(w.findAll('tbody td').map((c) => c.text())).toEqual(['+4', '0', '0']);
  });

  it('shows totals with the target', () => {
    const w = make({ target: 121 });
    expect(w.find('tfoot th').text()).toBe('Total / 121');
    expect(footerCells(w).map((c) => c.find('strong').text())).toEqual(['30', '20', '10']);
  });

  it('has no target text when there is no target', () => {
    expect(make().find('tfoot th').text()).toBe('Total');
  });

  describe('best-in-round highlighting', () => {
    it('highlights the highest scorer', () => {
      const w = make();
      const top = w.findAll('tbody tr')[0].findAll('td').map((c) => c.classes('top'));
      expect(top).toEqual([true, false, false]);
    });

    it('highlights the lowest scorer when low is better', () => {
      const w = make({ lowIsBetter: true });
      expect(w.findAll('tbody tr')[0].findAll('td').map((c) => c.classes('top'))).toEqual([false, false, true]);
    });

    it('highlights every tied best scorer', () => {
      const w = make({ rounds: [{ label: 'R', deltas: { a: 5, b: 5, c: 1 } }] });
      expect(w.findAll('tbody td').map((c) => c.classes('top'))).toEqual([true, true, false]);
    });

    it('highlights nobody when everyone is level', () => {
      const w = make({ rounds: [{ label: 'R', deltas: { a: 5, b: 5, c: 5 } }] });
      expect(w.findAll('tbody td').some((c) => c.classes('top'))).toBe(false);
    });
  });

  describe('places', () => {
    it('says leading for first and ordinals for the rest', () => {
      const w = make();
      expect(footerCells(w).map((c) => c.find('.place').text())).toEqual(['leading', '2nd', '3rd']);
      expect(footerCells(w).map((c) => c.classes('leader'))).toEqual([true, false, false]);
    });

    it('lets tied leaders share first and skips the next place', () => {
      const w = make({ players: [{ id: 'a', name: 'A', score: 9 }, { id: 'b', name: 'B', score: 9 }, { id: 'c', name: 'C', score: 1 }], rounds: [] });
      expect(footerCells(w).map((c) => c.find('.place').text())).toEqual(['leading', 'leading', '3rd']);
    });

    it('ranks the lowest first when low is better', () => {
      const w = make({ lowIsBetter: true });
      expect(footerCells(w).map((c) => c.find('.place').text())).toEqual(['3rd', '2nd', 'leading']);
    });

    it('writes ordinal places correctly from 1st to 13th and for 21st', () => {
      const many = Array.from({ length: 22 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, score: 100 - i }));
      const w = make({ players: many, rounds: [] });
      const places = footerCells(w).map((c) => c.find('.place').text());
      expect(places.slice(0, 13)).toEqual(['leading', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th']);
      expect(places[20]).toBe('21st');
      expect(places[21]).toBe('22nd');
    });
  });

  it('shows the empty state with a full-width cell', () => {
    const w = make({ rounds: [] });
    const cell = w.find('tbody td');
    expect(cell.text()).toBe('No rounds finished yet.');
    expect(cell.attributes('colspan')).toBe('4');
  });

  it('shows notes as visible text and as the cell tooltip', () => {
    const w = make();
    const cell = w.findAll('tbody tr')[1].findAll('td')[2];
    expect(cell.find('.note').text()).toBe('shot the moon');
    expect(cell.attributes('title')).toBe('shot the moon');
    expect(w.findAll('tbody tr')[0].find('.note').exists()).toBe(false);
  });

  describe('running totals', () => {
    it('are hidden by default', () => {
      expect(make().find('.run').exists()).toBe(false);
    });

    it('show the cumulative score after each round', () => {
      const w = make({ running: true });
      const rows = w.findAll('tbody tr');
      expect(rows[0].findAll('.run').map((r) => r.text())).toEqual(['(10)', '(5)', '(0)']);
      expect(rows[1].findAll('.run').map((r) => r.text())).toEqual(['(30)', '(20)', '(10)']);
    });
  });

  it('marks my column', () => {
    const w = make();
    expect(w.findAll('tbody tr')[0].findAll('td')[0].classes('me')).toBe(true);
    expect(w.findAll('tbody tr')[0].findAll('td')[1].classes('me')).toBe(false);
  });

  it('copes with a round that has no deltas', () => {
    const w = make({ rounds: [{ label: 'Blank' }] });
    expect(w.findAll('tbody td').map((c) => c.text())).toEqual(['0', '0', '0']);
  });
});

describe('ScoreTable with split totals', () => {
  it('gives each player a points column and a running-total column, with notes below both', () => {
    const w = make({ split: true });
    expect(w.findAll('thead th').map((h) => h.attributes('colspan') ?? '')).toEqual(['', '2', '2', '2']);
    const rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(3); // hand 1, hand 2 and the notes under hand 2
    expect(rows[0].findAll('td').map((c) => c.text())).toEqual(['+10', '10', '+5', '5', '0', '0']);
    expect(rows[1].findAll('td').map((c) => c.text())).toEqual(['+20', '30', '+15', '20', '+10', '10']);
    expect(rows[2].findAll('td')).toHaveLength(3);
    expect(rows[2].findAll('td')[2].attributes('colspan')).toBe('2');
    expect(rows[2].text()).toContain('shot the moon');
    expect(w.findAll('tfoot td')[0].attributes('colspan')).toBe('2');
  });
});
