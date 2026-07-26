import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the transform replaces source chunks with a widget shell', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  assert.match(lua, /return widget\(id, engine, chunks\[1\]\.block\.text, starter, extra_class_str\)/);
  assert.match(lua, /class=\"plotcat plotcat--side-by-side/);
});

test('the generated code block is marked for Quarto Live detection', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  assert.match(lua, /plotcat-live-cell/);
});

test('require-live.lua errors when plotcat-live-cell survives', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/require-live.lua', import.meta.url), 'utf8');
  assert.match(lua, /plotcat-live-cell/);
  assert.match(lua, /Quarto Live/);
});
