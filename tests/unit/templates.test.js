// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', '..', 'templates');

/**
 * Foundry v14's HandlebarsApplicationMixin requires each template part to render exactly one
 * HTML element. Handlebars blocks are stripped (keeping their inner markup) so the static
 * structure can be checked without a Handlebars runtime.
 */
function topLevelElements(source) {
  const markup = source
    .replace(/{{!--[\s\S]*?--}}/g, '')
    .replace(/{{![\s\S]*?}}/g, '')
    .replace(/{{[\s\S]*?}}/g, '');
  const host = document.createElement('div');
  host.innerHTML = markup;
  const strayText = [...host.childNodes].some(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '',
  );
  return { count: host.children.length, strayText };
}

describe('application templates', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.hbs'));

  it('there are templates to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s renders a single root element', (file) => {
    const { count, strayText } = topLevelElements(readFileSync(join(DIR, file), 'utf8'));
    expect(count).toBe(1);
    expect(strayText).toBe(false);
  });
});
