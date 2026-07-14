import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the transform replaces source chunks with a widget shell', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  assert.match(lua, /return widget\(id, engine, chunks\[1\]\.block\.text, starter, target_svg, extra_class_str\)/);
  assert.match(lua, /class=\"plotcat plotcat--side-by-side/);
  assert.doesNotMatch(lua, /target[^\n]*chunks\[1\]\.text/);
});
