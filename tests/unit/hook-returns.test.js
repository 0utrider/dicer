import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

/**
 * Foundry fires these hooks with Hooks.call, which stops at the first listener returning false (a
 * pre-hook listener's false also cancels the change). Dicer's listeners on them must never return a
 * value: an expression-bodied arrow (`() => a && b()`) can return false and silently cut off every
 * other module's listener after Dicer's (issue #1: Health Estimate's canvasReady never ran).
 */
const CALLED = /^(canvasReady|pre(Create|Update|Delete)\w+|preMoveToken|chatMessage|drop\w+|hotbarDrop|paste\w+|chatBubble\w*|activateNote|hotReload|preImportAdventure|dealCards|passCards|returnCards|modifyTokenAttribute)$/;

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('no Dicer listener on a Hooks.call hook has an expression body that could return false', () => {
  const bad = [];
  for (const file of files('src')) {
    const text = readFileSync(file, 'utf8');
    // Hooks.on('name', <arrow>) and the canvasReady list form: for (const hook of [...]) Hooks.on(hook, <arrow>)
    for (const m of text.matchAll(/Hooks\.(?:on|once)\(\s*(['"`])(\w+)\1\s*,\s*(\([^)]*\)|\w+)\s*=>\s*(\S)/g)) {
      if (CALLED.test(m[2]) && m[4] !== '{') bad.push(`${file}: ${m[2]}`);
    }
    for (const m of text.matchAll(/of\s*\[([^\]]*)\]\)\s*Hooks\.(?:on|once)\(\s*\w+\s*,\s*(\([^)]*\)|\w+)\s*=>\s*(\S)/g)) {
      const names = [...m[1].matchAll(/['"`](\w+)['"`]/g)].map((n) => n[1]);
      if (names.some((n) => CALLED.test(n)) && m[3] !== '{') bad.push(`${file}: ${names.join(', ')}`);
    }
  }
  expect(bad).toEqual([]);
});
