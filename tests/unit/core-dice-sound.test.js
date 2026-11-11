import { shouldDropCoreDiceSound, dropCoreDiceSound } from '../../src/foundry/core-dice-sound.js';

const CORE = 'sounds/dice.wav';
const rollWithDice = { dice: [{ faces: 20, results: [{ result: 12 }] }] };
const msg = (over = {}) => ({ sound: CORE, rolls: [rollWithDice], flags: {}, ...over });
const opts = (over = {}) => ({ enabled: true, coreSound: CORE, ...over });

describe('shouldDropCoreDiceSound', () => {
  it("drops Foundry's own dice sound on a roll Dicer will animate", () => {
    expect(shouldDropCoreDiceSound(msg(), opts())).toBe(true);
  });
  it('keeps it when the setting is off', () => {
    expect(shouldDropCoreDiceSound(msg(), opts({ enabled: false }))).toBe(false);
  });
  it('keeps a custom sound a system or module chose', () => {
    expect(shouldDropCoreDiceSound(msg({ sound: 'systems/x/crit.ogg' }), opts())).toBe(false);
  });
  it('keeps it when there are no dice to animate', () => {
    expect(shouldDropCoreDiceSound(msg({ rolls: [] }), opts())).toBe(false);
    expect(shouldDropCoreDiceSound(msg({ rolls: [{ dice: [] }] }), opts())).toBe(false);
  });
  it('keeps it when Dice So Nice style flags say the message is not animated', () => {
    expect(shouldDropCoreDiceSound(msg({ flags: { 'dice-so-nice': { skip: true } } }), opts())).toBe(false);
    expect(shouldDropCoreDiceSound(msg({ flags: { dicer: { pendingCard: true } } }), opts())).toBe(false);
  });
  it('never throws on odd input', () => {
    expect(shouldDropCoreDiceSound(null, opts())).toBe(false);
    expect(shouldDropCoreDiceSound({ sound: CORE, rolls: 'x' }, opts())).toBe(false);
  });
});

describe('dropCoreDiceSound (preCreateChatMessage)', () => {
  it('clears the sound on the message source', () => {
    const message = { ...msg(), updateSource: vi.fn() };
    dropCoreDiceSound(message, opts());
    expect(message.updateSource).toHaveBeenCalledWith({ sound: null });
  });
  it('leaves other messages untouched and swallows errors', () => {
    const message = { ...msg({ sound: 'x.ogg' }), updateSource: vi.fn() };
    dropCoreDiceSound(message, opts());
    expect(message.updateSource).not.toHaveBeenCalled();
    const broken = {
      ...msg(),
      updateSource: () => {
        throw new Error('nope');
      },
    };
    expect(() => dropCoreDiceSound(broken, opts())).not.toThrow();
  });
});
