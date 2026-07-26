import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the transform replaces source chunks with a widget shell', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  assert.match(lua, /return widget\(id, engine, chunks\[1\]\.block\.text, starter, extra_class_str, weights, dims\)/);
  assert.match(lua, /class=\"plotcat plotcat--side-by-side/);
});

test('PlotCat requires live-html format', async () => {
  const lua = await readFile(
    new URL(
      '../_extensions/plotcat/plotcat.lua',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    lua,
    /quarto\.doc\.is_format\("html"\)/
  );

  assert.match(
    lua,
    /quarto\.metadata\.get\("ojs-engine"\)/
  );

  assert.doesNotMatch(
    lua,
    /QUARTO_EXECUTE_INFO/
  );

  assert.doesNotMatch(
    lua,
    /metadata_is_true/
  );
});
