import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = await Promise.all(['plotcat.js', 'svg.js', 'runtime-manager.js'].map(name => readFile(new URL(`../_extensions/plotcat/${name}`, import.meta.url), 'utf8')));
const source = files.join('\n');

test('comparison stays SVG-only and local', () => {
  assert.doesNotMatch(source, /canvas|getImageData|toDataURL|\.png|fetch\(|XMLHttpRequest|sendBeacon/i);
});

test('required stable classes are present', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  for (const name of ['plotcat__header','plotcat__body','plotcat__target','plotcat__student','plotcat__plot','plotcat__editor','plotcat__textarea','plotcat__actions','plotcat__button','plotcat__status','plotcat__score','plotcat__feedback','plotcat__compare','plotcat__controls','plotcat__slider']) assert.match(lua, new RegExp(name));
});
