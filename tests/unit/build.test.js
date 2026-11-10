import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET = 4 * 1024 * 1024;
/** Loaded at world start besides dist/ (loadDigitAtlas). */
const WORLD_START_ASSETS = ['assets/fonts/digits.png', 'assets/fonts/digits.json'];

function worldStartBytes() {
  const dist = readdirSync('dist', { recursive: true })
    .map((f) => join('dist', f))
    .filter((p) => statSync(p).isFile());
  return [...dist, ...WORLD_START_ASSETS].reduce((sum, p) => sum + statSync(p).size, 0);
}

describe('build', () => {
  beforeAll(() => execSync('node node_modules/vite/bin/vite.js build', { stdio: 'pipe' }), 120000);
  it('emits dist/dicer.js referenced by module.json', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.esmodules).toEqual(['dist/dicer.js']);
    expect(statSync('dist/dicer.js').isFile()).toBe(true);
  });
  it('keeps dist/ plus the world-start font atlas under 4 MB', () => {
    const total = worldStartBytes();
    const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
    console.info(
      `dicer size guard: ${kib(total)} of ${kib(BUDGET)} (dist/ + digits.png + digits.json); ` +
        `headroom ${kib(BUDGET - total)}`,
    );
    expect(total).toBeLessThanOrEqual(BUDGET);
  });
});
