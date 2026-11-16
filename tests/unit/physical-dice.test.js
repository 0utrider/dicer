// @vitest-environment jsdom
/**
 * Rolls from physical dice (Pixels, another Bluetooth module, manual entry): which dice count,
 * the chat card mark (physicalDice 'mark' / 'skip') and the skip in showForRoll.
 */
import { physicalOf, allPhysical, markCard } from '../../src/hand/gate-hand.js';

let mode;
beforeEach(() => {
  mode = 'mark';
  globalThis.CONFIG = {
    Dice: {
      fulfillment: {
        methods: {
          mersenne: { label: 'Random' },
          manual: { label: 'DICE.Manual', interactive: true },
          dicer: { label: 'DICER.Hand.Method', interactive: true },
          pixels: { label: 'Pixels - Electronic Dice', interactive: true },
        },
      },
    },
  };
  globalThis.game = {
    settings: {
      get: (ns, k) => {
        if (ns === 'dicer' && k === 'physicalDice') return mode;
        throw new Error('not registered');
      },
    },
    i18n: {
      localize: (k) => (k === 'DICE.Manual' ? 'Manual' : k),
      format: (k, d) => `${k}:${d.methods}`,
    },
  };
});
afterEach(() => {
  delete globalThis.CONFIG;
  delete globalThis.game;
});

const roll = (...methods) => ({ options: {}, dice: methods.map((method) => ({ method })) });
const card = () => {
  const html = document.createElement('div');
  html.innerHTML = '<header class="message-metadata"><time></time></header>';
  return html;
};
const mark = (html) => html.querySelector('.dicer-card-physical');

test('physicalOf: interactive methods other than Dicer, once each', () => {
  expect(physicalOf(roll('pixels', 'pixels', 'manual'))).toEqual(['pixels', 'manual']);
  expect(physicalOf(roll('mersenne', 'dicer', undefined))).toEqual([]);
  expect(physicalOf(null)).toEqual([]);
});

test('allPhysical: every die rolled physically, and at least one die', () => {
  expect(allPhysical(roll('pixels', 'manual'))).toBe(true);
  expect(allPhysical(roll('pixels', 'mersenne'))).toBe(false);
  expect(allPhysical(roll('pixels', 'dicer'))).toBe(false);
  expect(allPhysical(roll())).toBe(false);
});

test('the card gets one physical mark naming the methods (mark and skip), none with animate', () => {
  const message = { rolls: [roll('pixels', 'mersenne'), roll('manual')] };
  let html = card();
  markCard(message, html);
  expect(mark(html).dataset.tooltip).toBe('DICER.Physical.Mark:Pixels - Electronic Dice, Manual');
  markCard(message, html); // a re-render does not add a second
  expect(html.querySelectorAll('.dicer-card-physical')).toHaveLength(1);
  mode = 'skip';
  html = card();
  markCard(message, html);
  expect(mark(html)).not.toBeNull();
  mode = 'animate';
  html = card();
  markCard(message, html);
  expect(mark(html)).toBeNull();
});

test('no physical dice, or the setting not registered: no mark', () => {
  let html = card();
  markCard({ rolls: [roll('mersenne')] }, html);
  expect(mark(html)).toBeNull();
  globalThis.game.settings.get = () => {
    throw new Error('not registered');
  };
  html = card();
  markCard({ rolls: [roll('pixels')] }, html);
  expect(mark(html)).toBeNull();
});

test('a hand-thrown roll with physical dice gets both marks, each once', () => {
  globalThis.game.i18n.localize = (k) => k;
  const hand = { options: { dicerHand: { id: 'h', by: 'u', n: 1 } }, dice: [{ method: 'dicer' }] };
  const html = card();
  markCard({ rolls: [hand, roll('pixels')] }, html);
  markCard({ rolls: [hand, roll('pixels')] }, html);
  expect(html.querySelectorAll('.dicer-card-hand')).toHaveLength(1);
  expect(html.querySelectorAll('.dicer-card-physical')).toHaveLength(1);
});
