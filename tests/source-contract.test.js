import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
  const extension = await readFile(new URL('../_extensions/plotcat/_extension.yml', import.meta.url), 'utf8');
  for (const name of ['plotcat__header','plotcat__body','plotcat__target','plotcat__student','plotcat__plot','plotcat__editor','plotcat__actions','plotcat__button','plotcat__status','plotcat__score','plotcat__feedback','plotcat__compare','plotcat__controls','plotcat__wipe-handle','completion: true','runbutton: false']) assert.match(lua, new RegExp(name));
  assert.doesNotMatch(lua, /live\/live\.lua/);
  assert.equal(existsSync(new URL('../_extensions/plotcat/live', import.meta.url)), false);
  assert.match(lua, /engine == "r" and "webr" or "pyodide"/);
  assert.match(extension, /path: plotcat\.lua\s+at: pre-ast/);
  assert.doesNotMatch(lua, /plotcat__slider|data-plotcat-wipe=/);
  assert.doesNotMatch(lua, /plotcat__textarea|plotcat-highlight-overlay/);
});

test('the wipe handle has one pointer listener for each pointer action', async () => {
  const ui = await readFile(new URL('../_extensions/plotcat/plotcat.js', import.meta.url), 'utf8');
  assert.equal((ui.match(/wipeHandle\.addEventListener\('pointerdown'/g) || []).length, 1);
  assert.equal((ui.match(/wipeHandle\.addEventListener\('pointermove'/g) || []).length, 1);
});
