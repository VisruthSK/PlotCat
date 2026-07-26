import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the transform replaces source chunks with a widget shell', async () => {
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  assert.match(lua, /return widget\(id, engine, chunks\[1\]\.block\.text, starter, extra_class_str\)/);
  assert.match(lua, /class=\"plotcat plotcat--side-by-side/);
});

test('interactive PlotCat requires Quarto Live metadata', async () => {
  const lua = await readFile(
    new URL(
      '../_extensions/plotcat/plotcat.lua',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    lua,
    /quarto\.metadata\.get\(key\)/
  );

  assert.match(
    lua,
    /metadata_is_true\("ojs-engine"\)/
  );

  assert.match(
    lua,
    /quarto\.doc\.is_format\("html"\)/
  );

  assert.doesNotMatch(
    lua,
    /QUARTO_EXECUTE_INFO/
  );
});
