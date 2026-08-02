import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteSvgIdReferences } from '../_extensions/plotcat/svg.js';

test('SVG id renaming preserves href and url fragment references', () => {
  const normalized = new Map([
    ['marker', 'id0'],
    ['clip', 'id1']
  ]);
  const scoped = new Map([
    ['id0', 'plot-id0'],
    ['id1', 'plot-id1']
  ]);

  const rewriteTwice = value => rewriteSvgIdReferences(
    rewriteSvgIdReferences(value, normalized),
    scoped
  );

  assert.equal(rewriteTwice('#marker'), '#plot-id0');
  assert.equal(rewriteTwice('url(#clip)'), 'url(#plot-id1)');
  assert.equal(rewriteTwice("url('#clip')"), 'url(#plot-id1)');
  assert.equal(rewriteTwice('url("#clip")'), 'url(#plot-id1)');
  assert.equal(rewriteTwice('url(https://example.test/image.svg#clip)'), 'url(https://example.test/image.svg#clip)');
});
