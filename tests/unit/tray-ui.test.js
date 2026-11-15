// @vitest-environment jsdom
/**
 * The dice tray's window: die buttons (click adds one, right-click / minus / Backspace removes
 * one) with a count badge, a live formula at the top, a modifier stepper, plain "who sees it"
 * labels, and a Throw button that names what it throws and is disabled with no dice. The real
 * template is rendered with Handlebars and wired with wireTray, as the window does.
 */
import { readFileSync } from 'node:fs';
import Handlebars from 'handlebars';
import { resolve } from './lang-check.js';

vi.mock('../../src/hand/chunk/overlay.js', () => ({ openThrowOverlay: vi.fn() }));
const { stepCount, trayView, trayContext, wireTray, paintTray, TRAY_DICE, TRAY_MODES } = await import(
  '../../src/hand/chunk/tray.js'
);

const lang = JSON.parse(readFileSync('lang/en.json', 'utf8'));
const localize = (k) => {
  const v = resolve(lang, k);
  return typeof v === 'string' ? v : k;
};
const format = (k, data) => localize(k).replace(/{(\w+)}/g, (_, n) => data[n] ?? '');
const H = Handlebars.create();
H.registerHelper('localize', (k) => localize(k));
const template = H.compile(readFileSync('templates/dice-tray.hbs', 'utf8'));

beforeEach(() => {
  globalThis.game = {
    i18n: { localize, format },
    settings: { get: () => 'public' },
  };
});
afterEach(() => {
  delete globalThis.game;
  document.body.innerHTML = '';
});

/** The tray as the window shows it: the template in a form, wired to `state`. */
function mount(state = { counts: {}, modifier: 0 }) {
  const form = document.createElement('form');
  form.innerHTML = template(trayContext(state));
  document.body.append(form);
  const onChange = vi.fn();
  wireTray(form, state, onChange);
  return { form, state, onChange };
}
const die = (form, key) => form.querySelector(`.dicer-tray-die[data-die="${key}"]`);
const addBtn = (form, key) => die(form, key).querySelector('.dicer-tray-add');
const removeBtn = (form, key) => die(form, key).querySelector('.dicer-tray-remove');
const throwBtn = (form) => form.querySelector('button[type="submit"]');
const formulaText = (form) => form.querySelector('.dicer-tray-formula').textContent.trim();
const click = (el, init = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
const rightClick = (el) =>
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

test('stepCount adds and removes one die, never below 0 or above 99, without mutating', () => {
  const counts = { d6: 1 };
  expect(stepCount(counts, 'd6', 1)).toEqual({ d6: 2 });
  expect(stepCount(counts, 'd6', -1)).toEqual({ d6: 0 });
  expect(stepCount({}, 'd20', -1)).toEqual({ d20: 0 });
  expect(stepCount({ d4: 99 }, 'd4', 1)).toEqual({ d4: 99 });
  expect(counts).toEqual({ d6: 1 });
  // an unknown die is ignored
  expect(stepCount(counts, 'd7', 1)).toEqual({ d6: 1 });
});

test('trayView: the formula, whether it can throw, and a Throw label that counts the dice', () => {
  expect(trayView({ counts: { d6: 2, d20: 1 }, modifier: 3 })).toEqual({
    formula: '2d6 + 1d20 + 3',
    canThrow: true,
    canClear: true,
    throwLabel: 'Throw 3 dice',
  });
  const empty = trayView({ counts: {}, modifier: 0 });
  expect(empty.canThrow).toBe(false);
  expect(empty.canClear).toBe(false);
  expect(empty.formula).toBe('');
  expect(empty.throwLabel).toBe(localize('DICER.Tray.ThrowNone'));
  // a modifier alone is not a throw, but can be cleared
  expect(trayView({ counts: {}, modifier: 2 })).toMatchObject({ canThrow: false, canClear: true });
});

test('the modes read as who sees the roll', () => {
  const ctx = trayContext({});
  expect(ctx.modes.map((m) => m.value)).toEqual(TRAY_MODES);
  expect(ctx.modes.map((m) => m.label)).toEqual(
    TRAY_MODES.map((m) => resolve(lang, `DICER.Tray.Modes.${m}`)),
  );
  for (const m of ctx.modes) expect(m.label).not.toMatch(/^DICER\./);
});

test('each die is a button with its shape, name and a hidden count badge', () => {
  const { form } = mount();
  expect([...form.querySelectorAll('.dicer-tray-die')].map((d) => d.dataset.die)).toEqual(TRAY_DICE);
  for (const key of TRAY_DICE) {
    const btn = addBtn(form, key);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.textContent).toContain(key);
    expect(die(form, key).classList.contains('has-dice')).toBe(false);
  }
});

test('nothing picked: a placeholder formula, Throw and Clear disabled', () => {
  const { form } = mount();
  expect(formulaText(form)).toBe(localize('DICER.Tray.Empty'));
  expect(form.querySelector('.dicer-tray-formula').classList.contains('is-empty')).toBe(true);
  expect(throwBtn(form).disabled).toBe(true);
  expect(throwBtn(form).textContent).toContain(localize('DICER.Tray.ThrowNone'));
  expect(form.querySelector('[data-action="clear"]').disabled).toBe(true);
});

test('clicking a die adds one: badge, formula and Throw label follow', () => {
  const { form, state, onChange } = mount();
  click(addBtn(form, 'd6'));
  click(addBtn(form, 'd6'));
  click(addBtn(form, 'd20'));
  expect(state.counts).toMatchObject({ d6: 2, d20: 1 });
  expect(onChange).toHaveBeenCalledTimes(3);
  expect(die(form, 'd6').classList.contains('has-dice')).toBe(true);
  expect(die(form, 'd6').querySelector('.dicer-tray-count').textContent).toBe('2');
  expect(formulaText(form)).toBe('2d6 + 1d20');
  expect(throwBtn(form).disabled).toBe(false);
  expect(throwBtn(form).textContent).toContain('Throw 3 dice');
  expect(form.querySelector('[data-action="clear"]').disabled).toBe(false);
});

test('right-click, the minus button and Backspace each remove one', () => {
  const { form, state } = mount({ counts: { d8: 3 }, modifier: 0 });
  expect(die(form, 'd8').querySelector('.dicer-tray-count').textContent).toBe('3');
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  addBtn(form, 'd8').dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true); // no browser menu
  expect(state.counts.d8).toBe(2);
  click(removeBtn(form, 'd8'));
  expect(state.counts.d8).toBe(1);
  addBtn(form, 'd8').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  expect(state.counts.d8).toBe(0);
  expect(die(form, 'd8').classList.contains('has-dice')).toBe(false);
  rightClick(addBtn(form, 'd8')); // stays at 0
  expect(state.counts.d8).toBe(0);
  expect(throwBtn(form).disabled).toBe(true);
});

test('the modifier stepper and typing both update the formula', () => {
  const { form, state } = mount({ counts: { d20: 1 }, modifier: 0 });
  const plus = form.querySelector('[data-mod-step="1"]');
  const minus = form.querySelector('[data-mod-step="-1"]');
  click(plus);
  click(plus);
  expect(state.modifier).toBe(2);
  expect(form.elements.namedItem('modifier').value).toBe('2');
  expect(formulaText(form)).toBe('1d20 + 2');
  click(minus);
  click(minus);
  click(minus);
  expect(formulaText(form)).toBe('1d20 - 1');
  const input = form.elements.namedItem('modifier');
  input.value = '5';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(state.modifier).toBe(5);
  expect(formulaText(form)).toBe('1d20 + 5');
  expect(throwBtn(form).textContent).toContain('Throw 1 die');
});

test('the roll mode select keeps the state', () => {
  const { form, state } = mount({ counts: {}, modifier: 0, mode: 'gm' });
  const select = form.elements.namedItem('mode');
  expect(select.value).toBe('gm');
  select.value = 'blind';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(state.mode).toBe('blind');
});

test('paintTray works on a re-rendered form (wiring is per element, painting per render)', () => {
  const { form, state } = mount();
  click(addBtn(form, 'd4'));
  form.innerHTML = template(trayContext(state));
  paintTray(form, state);
  expect(formulaText(form)).toBe('1d4');
  click(addBtn(form, 'd4')); // listeners survive the re-render (delegated on the form)
  expect(state.counts.d4).toBe(2);
});
