import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = resolve('.test-output');
try { rmSync(output, { recursive: true, force: true }); } catch {}

function render(file) {
  let source = readFileSync(resolve('tests/fixtures', file), 'utf8')
    .replace('../../_extensions/plotcat/plotcat.lua', 'plotcat');
  writeFileSync(resolve(output, file), source);
  const windows = process.platform === 'win32';
  const executable = windows ? 'quarto.cmd' : 'quarto';
  const isInteractive = file !== 'wrong-format.qmd' && file !== 'non-html.qmd';
  const args = isInteractive ? ['render', file, '--to', 'live-html'] : ['render', file];
  return spawnSync(executable, args, {
    encoding: 'utf8',
    cwd: output,
    shell: windows
  });
}

function assertRendered(fixture) {
  const result = render(fixture);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  if (fixture !== 'non-html.qmd') {
    const htmlFile = fixture.replace(/\.qmd$/, '.html');
    return readFileSync(resolve(output, htmlFile), 'utf8');
  }
}

function assertWeights(fixture, expected) {
  const html = assertRendered(fixture);
  const match = html.match(/data-plotcat-weights="([^"]+)"/);
  assert.ok(match, `data-plotcat-weights attribute not found in ${fixture}`);
  const decoded = JSON.parse(atob(match[1]));
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(decoded.svg[key], value, `Weight mismatch for ${key} in ${fixture}`);
  }
}

try {
  mkdirSync(output, { recursive: true });
  cpSync(resolve('_extensions'), resolve(output, '_extensions'), { recursive: true });
  cpSync(resolve('website/_extensions/r-wasm'), resolve(output, '_extensions/r-wasm'), { recursive: true });
  writeFileSync(resolve(output, '_quarto.yml'), 'format:\n  live-html:\n    toc: true\n');

  const html = assertRendered('minimal.qmd');
  assert.match(html, /class="plotcat plotcat--side-by-side"/);
  assert.match(html, /data-plotcat-target-code="[A-Za-z0-9+/=]+"/);
  assert.doesNotMatch(html, /data-plotcat-salt=/);
  assert.match(html, /class="plotcat__target-loading"/);
  assert.doesNotMatch(html, /plot\(cars\)/);
  assert.doesNotMatch(html, /plotcat-live-cell/);
  assert.match(html, /type="module"/);

  const generatedHtml = assertRendered('missing-id.qmd');
  assert.match(generatedHtml, /id="plotcat-exercise-1"/);

  const twoHtml = assertRendered('two-chunks.qmd');
  assert.match(twoHtml, /id="plotcat-two-r"/);
  assert.match(twoHtml, /&quot;engine&quot;:&quot;r&quot;/);
  assert.doesNotMatch(twoHtml, /&quot;packages&quot;/);
  assert.match(twoHtml, /id="webr-/);
  assert.doesNotMatch(twoHtml, /cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror/);
  assert.doesNotMatch(twoHtml, /main = "Target title"/);

  const multipleHtml = assertRendered('multiple.qmd');
  assert.equal((multipleHtml.match(/class="plotcat plotcat--side-by-side"/g) || []).length, 2);
  assert.equal((multipleHtml.match(/plotcat\.js" type="module"/g) || []).length, 1);

  assertRendered('non-html.qmd');

  assertWeights('weights.qmd', { geometry: 0.3, text: 0.5, style: 0.1, frame: 0.15 });
  assertWeights('weights-frontmatter.qmd', { geometry: 0.7, text: 0.2, style: 0.1 });

  for (const [fixture, message] of [
    ['zero-chunks.qmd', 'needs one target chunk'],
    ['too-many.qmd', 'more than two executable chunks'],
    ['mixed.qmd', 'mixes engines'],
    ['invalid-attribute.qmd', "attribute 'title' is not supported; only id, weight, and dimension attributes are allowed"],
    ['executed-starter.qmd', 'starter chunk executed'],
    ['duplicate-id.qmd', "duplicate id 'same'"],
    ['unsupported-engine.qmd', "unsupported engine 'bash'"],
    ['wrong-format.qmd', 'requires format: live-html']
  ]) {
    const result = render(fixture);
    assert.notEqual(result.status, 0, `${fixture} unexpectedly rendered`);
    assert.match(result.stdout + result.stderr, new RegExp(message));
  }

  // Quarto Live owns runtime package installation
  const lua = await readFile(
    new URL('../_extensions/plotcat/plotcat.lua', import.meta.url),
    'utf8'
  );

  const runtime = await readFile(
    new URL('../_extensions/plotcat/runtime-manager.js', import.meta.url),
    'utf8'
  );

  const pyodide = await readFile(
    new URL('../_extensions/plotcat/pyodide-adapter.js', import.meta.url),
    'utf8'
  );

  const webr = await readFile(
    new URL('../_extensions/plotcat/webr-adapter.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(lua, /packages_for/);
  assert.doesNotMatch(lua, /packages\s*=/);
  assert.doesNotMatch(runtime, /manifest\.packages/);
  assert.doesNotMatch(runtime, /installPackages/);
  assert.doesNotMatch(pyodide, /micropip|pyimport|loadPackage/);
  assert.doesNotMatch(webr, /installPackages/);
} finally {
  try { rmSync(output, { recursive: true, force: true }); } catch {}
}
