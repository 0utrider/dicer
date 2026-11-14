import { jb2aSource } from '../../src/jb2a/source.js';

const modulesOf = (active) => ({ get: (id) => (id in active ? { active: active[id] } : undefined) });
const settingsOf = (location) => ({ get: () => location });

test('an active jb2a_patreon with location "" gives modules', () => {
  expect(jb2aSource({ modules: modulesOf({ jb2a_patreon: true, JB2A_DnD5e: true }), settings: settingsOf('') })).toEqual({
    moduleId: 'jb2a_patreon',
    location: 'modules',
  });
});

test('an inactive patreon plus an active JB2A_DnD5e gives the free id', () => {
  expect(jb2aSource({ modules: modulesOf({ jb2a_patreon: false, JB2A_DnD5e: true }), settings: settingsOf('') })).toEqual({
    moduleId: 'JB2A_DnD5e',
    location: 'modules',
  });
});

test('neither active gives null', () => {
  expect(jb2aSource({ modules: modulesOf({ jb2a_patreon: false }), settings: settingsOf('') })).toBeNull();
  expect(jb2aSource({ modules: modulesOf({}), settings: settingsOf('') })).toBeNull();
});

test('a custom location is used with its trailing slash stripped', () => {
  const settings = { get: vi.fn(() => 'assets/jb2a/') };
  expect(jb2aSource({ modules: modulesOf({ JB2A_DnD5e: true }), settings })).toEqual({
    moduleId: 'JB2A_DnD5e',
    location: 'assets/jb2a',
  });
  expect(settings.get).toHaveBeenCalledWith('JB2A_DnD5e', 'jb2aLocation');
});

test('a throwing settings.get gives modules', () => {
  const settings = {
    get: () => {
      throw new Error('not registered');
    },
  };
  expect(jb2aSource({ modules: modulesOf({ jb2a_patreon: true }), settings })).toEqual({
    moduleId: 'jb2a_patreon',
    location: 'modules',
  });
});
