// A player's avatar (or a computer player's robot) on the page.  This is one of the few places the site puts markup
// into the DOM with v-html, which is only safe because the markup is built from the avatar catalogue and never from
// what a player sent; an avatar is stored on the server and shown to everybody at the table, so that is the promise
// worth protecting.  Alongside it: the figure is decoration (hidden from screen readers) unless it is given a label,
// it is drawn at the size asked for, and a robot is drawn instead when asked.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { AVATAR_SLOTS, DEFAULT_AVATAR } from '../../shared/avatar.js';
import { pickOne, seeded } from '../../shared/random.js';
import AvatarFigure from './AvatarFigure.vue';

/** The figure's drawing with the per-drawing gradient and clip ids taken out, so that two drawings can be compared. */
const drawing = (wrapper) => wrapper.element.innerHTML.replace(/(avatar|robot)-[a-z]+-\d+/g, 'drawing-id');
const draw = (props) => mount(AvatarFigure, { props });

describe('AvatarFigure', () => {
  it('is a square SVG picture with something drawn in it', () => {
    const w = draw({ avatar: DEFAULT_AVATAR });
    expect(w.element.localName).toBe('svg');
    expect(w.attributes('viewBox')).toBe('0 0 100 100');
    expect(w.element.children.length).toBeGreaterThan(0);
  });

  it('draws the default avatar when given none', () => {
    expect(drawing(draw({}))).toBe(drawing(draw({ avatar: DEFAULT_AVATAR })));
  });

  it('draws the avatar it is given, and draws it again when it changes', async () => {
    const plain = drawing(draw({ avatar: DEFAULT_AVATAR }));
    const w = draw({ avatar: { ...DEFAULT_AVATAR, hat: 'crown' } });
    const crowned = drawing(w);
    expect(crowned).not.toBe(plain);
    await w.setProps({ avatar: DEFAULT_AVATAR });
    expect(drawing(w)).toBe(plain);
  });

  it('draws the robot instead for a computer player, whatever avatar it was given', () => {
    const robot = drawing(draw({ robot: true, seed: 'bot-1 Robbie' }));
    expect(robot).not.toBe(drawing(draw({ avatar: DEFAULT_AVATAR })));
    expect(drawing(draw({ robot: true, seed: 'bot-1 Robbie', avatar: { ...DEFAULT_AVATAR, hat: 'crown' } }))).toBe(robot);
  });

  it('gives the same robot the same picture every time', () => {
    expect(drawing(draw({ robot: true, seed: 'bot-1 Robbie' }))).toBe(drawing(draw({ robot: true, seed: 'bot-1 Robbie' })));
  });

  it('is drawn at the size asked for, as wide as it is tall', () => {
    const style = draw({ size: '2.5rem' }).element.style;
    expect(style.width).toBe('2.5rem');
    expect(style.height).toBe('2.5rem');
  });

  it('is decoration, hidden from screen readers, when it has no label', () => {
    const w = draw({});
    expect(w.attributes('aria-hidden')).toBe('true');
    expect(w.attributes('role')).toBeUndefined();
    expect(w.attributes('aria-label')).toBeUndefined();
  });

  it('is a named image when it is given a label', () => {
    const w = draw({ label: "Ann's avatar" });
    expect(w.attributes('role')).toBe('img');
    expect(w.attributes('aria-label')).toBe("Ann's avatar");
    expect(w.attributes('aria-hidden')).toBeUndefined();
  });
});

describe('a hostile avatar (seeded)', () => {
  const HOSTILE = ['<script>alert(1)</script>', '"/><image href="x" onerror="alert(1)"/>', '</svg><img src=x onerror=alert(1)>', '#fff" onload="alert(1)', 'url(javascript:alert(1))', '__proto__', 'constructor', 'toString', '', 'nope'];
  const ODD = [null, 0, 1, true, [], {}, ['crown'], { id: 'crown' }];
  const slots = AVATAR_SLOTS.map((slot) => slot.slot);
  // The only kinds of element the catalogue's drawings are made of; anything else was smuggled in.
  const forbidden = 'script, image, img, foreignObject, iframe, a, use, style, animate, set';

  it('draws only catalogue shapes: nothing a player could have typed reaches the markup', () => {
    const SEED = 60606;
    const rng = seeded(SEED);
    for (let step = 0; step < 150; step++) {
      // Written as JSON and parsed, as an avatar arrives from the server: a `__proto__` slot is then a property like any other.
      const chosen = [];
      for (const slot of [...slots, 'extra', '__proto__']) {
        const roll = rng();
        if (roll < 0.4) chosen.push([slot, pickOne(HOSTILE, rng)]);
        else if (roll < 0.6) chosen.push([slot, pickOne(ODD, rng)]);
        else if (roll < 0.8 && slots.includes(slot)) chosen.push([slot, pickOne(AVATAR_SLOTS.find((s) => s.slot === slot).options, rng).id]);
      }
      const json = `{${chosen.map(([slot, value]) => `${JSON.stringify(slot)}:${JSON.stringify(value)}`).join(',')}}`;
      const avatar = JSON.parse(json);
      const where = `seed ${SEED} step ${step}: ${json}`;
      let w;
      expect(() => (w = draw({ avatar, label: pickOne(HOSTILE, rng), seed: pickOne(HOSTILE, rng), robot: rng() < 0.2 })), where).not.toThrow();
      expect(w.element.querySelector(forbidden), where).toBeNull();
      for (const el of w.element.querySelectorAll('*')) {
        for (const attribute of el.attributes) {
          expect(attribute.name.startsWith('on'), `${where} <${el.localName} ${attribute.name}>`).toBe(false);
          expect(/javascript:|alert\(/i.test(attribute.value), `${where} <${el.localName} ${attribute.name}="${attribute.value}">`).toBe(false);
        }
      }
      for (const text of HOSTILE.filter(Boolean)) expect(w.element.innerHTML.includes(text), `${where} carries ${text}`).toBe(false);
      w.unmount();
    }
  });

  it('draws an avatar made entirely of things the catalogue does not have as the default one', () => {
    const SEED = 3;
    const rng = seeded(SEED);
    const plain = drawing(draw({ avatar: DEFAULT_AVATAR }));
    for (let step = 0; step < 40; step++) {
      const avatar = Object.fromEntries(slots.map((slot) => [slot, pickOne(HOSTILE, rng)]));
      const where = `seed ${SEED} step ${step}: ${JSON.stringify(avatar)}`;
      let drawn;
      expect(() => (drawn = drawing(draw({ avatar }))), where).not.toThrow();
      expect(drawn, where).toBe(plain);
    }
  });
});
