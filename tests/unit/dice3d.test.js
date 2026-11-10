import { createDice3dApi } from '../../src/api/dice3d.js';
import { planThrow } from '../../src/throw/throw-planner.js';

function fakeDiceBox() {
  const rolls = [];
  return {
    rolls,
    get activeRolls() {
      return rolls.length;
    },
    roll: vi.fn((specs) => {
      let resolve;
      const landed = new Promise((r) => (resolve = r));
      rolls.push({ specs, resolve });
      return { landed, finished: landed };
    }),
  };
}

const roll = (faces, result) => ({ dice: [{ faces, results: [{ result, active: true }] }] });

let diceBox, gate, api, settings;
beforeEach(() => {
  diceBox = fakeDiceBox();
  gate = { disabled: false, waitFor: vi.fn(async () => true) };
  settings = { enabled: true, maxDice: 20 };
  api = createDice3dApi({
    diceBox,
    gate,
    planThrow,
    getSetting: (k) => settings[k],
    renderer: { isLooping: true },
  });
});

test('isEnabled follows the enabled setting', () => {
  expect(api.isEnabled()).toBe(true);
  settings.enabled = false;
  expect(api.isEnabled()).toBe(false);
});

test('showForRoll resolves true after landing', async () => {
  let result = null;
  api.showForRoll(roll(20, 12)).then((v) => (result = v));
  await Promise.resolve();
  expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 12 }]);
  expect(result).toBe(null);
  diceBox.rolls[0].resolve();
  await new Promise((r) => setTimeout(r, 0));
  expect(result).toBe(true);
});

test('showForRoll resolves false for blind', async () => {
  await expect(api.showForRoll(roll(20, 12), {}, false, null, true)).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

test('showForRoll resolves false for a roll with only d7s', async () => {
  await expect(api.showForRoll(roll(7, 3))).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

test('showForRoll resolves false when diceBox.roll throws', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  diceBox.roll.mockImplementation(() => {
    throw new Error('boom');
  });
  await expect(api.showForRoll(roll(20, 1))).resolves.toBe(false);
  spy.mockRestore();
});

test('waitFor3DAnimationByMessageID delegates to gate.waitFor', async () => {
  await expect(api.waitFor3DAnimationByMessageID('m1')).resolves.toBe(true);
  expect(gate.waitFor).toHaveBeenCalledWith('m1');
});

test('messageHookDisabled proxies gate.disabled', () => {
  expect(api.messageHookDisabled).toBe(false);
  api.messageHookDisabled = true;
  expect(gate.disabled).toBe(true);
  gate.disabled = false;
  expect(api.messageHookDisabled).toBe(false);
});

test('_debug exposes isLooping and activeRolls', () => {
  expect(api._debug.isLooping).toBe(true);
  expect(api._debug.activeRolls).toBe(0);
  api.showForRoll(roll(6, 2));
  expect(api._debug.activeRolls).toBe(1);
});
