import { describe, it, expect, vi } from 'vitest';
import { registerChatCommands, COMMAND_NAMES } from '../../src/compat/chat-commands.js';

describe('registerChatCommands', () => {
  it('registers /dice3d, /d3d and /dsn for the dicer module', () => {
    const register = vi.fn();
    registerChatCommands({ register }, { openSettings: () => {} });
    expect(register).toHaveBeenCalledTimes(3);
    expect(register.mock.calls.map(([c]) => c.name)).toEqual(['/dice3d', '/d3d', '/dsn']);
    expect(COMMAND_NAMES).toEqual(['/dice3d', '/d3d', '/dsn']);
    for (const [command] of register.mock.calls) {
      expect(command.module).toBe('dicer');
      expect(command.shouldDisplayToChat).toBe(false);
    }
  });

  it('opens the settings and returns {} so no chat message is posted', () => {
    const register = vi.fn();
    const openSettings = vi.fn();
    registerChatCommands({ register }, { openSettings });
    for (const [command] of register.mock.calls) {
      expect(command.callback({}, '', {})).toEqual({});
    }
    expect(openSettings).toHaveBeenCalledTimes(3);
  });

  it('still returns {} when opening the settings throws', () => {
    const register = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerChatCommands(
      { register },
      {
        openSettings: () => {
          throw new Error('boom');
        },
      },
    );
    expect(register.mock.calls[0][0].callback()).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does nothing when the chat-commands API has no register', () => {
    expect(() => registerChatCommands({}, { openSettings: () => {} })).not.toThrow();
    expect(() => registerChatCommands(null, { openSettings: () => {} })).not.toThrow();
  });

  it('keeps registering the rest when one registration throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const register = vi.fn((c) => {
      if (c.name === '/d3d') throw new Error('taken');
    });
    registerChatCommands({ register }, { openSettings: () => {} });
    expect(register).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
