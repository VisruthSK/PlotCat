import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = await Promise.all(['plotcat.js', 'svg.js', 'runtime-manager.js'].map(name => readFile(new URL(`../_extensions/plotcat/${name}`, import.meta.url), 'utf8')));
const source = files.join('\n');

test('comparison stays SVG-only and local', () => {
  assert.doesNotMatch(source, /canvas|getImageData|toDataURL|\.png|fetch\(|XMLHttpRequest|sendBeacon/i);
});

test('wipe uses one centered plot column and theming follows Bootstrap variables', async () => {
  const css = await readFile(new URL('../_extensions/plotcat/plotcat.css', import.meta.url), 'utf8');
  assert.match(css, /\.plotcat--wipe \.plotcat__body[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /--plotcat-accent-rgb: var\(--bs-primary-rgb/);
  assert.match(css, /--plotcat-nested-bg: color-mix\(in srgb, var\(--bs-body-color/);
  assert.doesNotMatch(css, /rgba\(0, 0, 0|color:\s*#fff(?:fff)?/);
  assert.doesNotMatch(css, /prefers-color-scheme|Explicit Dark Mode Overrides/);
});

test('required stable classes are present', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  for (const name of ['plotcat__header','plotcat__body','plotcat__target','plotcat__student','plotcat__plot','plotcat__editor','plotcat__textarea','plotcat__actions','plotcat__button','plotcat__status','plotcat__score','plotcat__feedback','plotcat__compare','plotcat__controls','plotcat__slider','plotcat__wipe-handle']) assert.match(lua, new RegExp(name));
});
