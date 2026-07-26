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

try {
  mkdirSync(output, { recursive: true });
  cpSync(resolve('_extensions'), resolve(output, '_extensions'), { recursive: true });
  cpSync(resolve('website/_extensions/r-wasm'), resolve(output, '_extensions/r-wasm'), { recursive: true });
  writeFileSync(resolve(output, '_quarto.yml'), 'format:\n  live-html:\n    toc: true\n');
  const valid = render('minimal.qmd');
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  const html = readFileSync(resolve(output, 'minimal.html'), 'utf8');
  assert.match(html, /class="plotcat plotcat--side-by-side"/);
  assert.match(html, /data-plotcat-target-code="[A-Za-z0-9+/=]+"/);
  assert.doesNotMatch(html, /data-plotcat-salt=/);
  assert.match(html, /class="plotcat__target-loading"/);
  assert.doesNotMatch(html, /plot\(cars\)/);
  assert.doesNotMatch(html, /plotcat-live-cell/);
  assert.match(html, /type="module"/);

  const generated = render('missing-id.qmd');
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const generatedHtml = readFileSync(resolve(output, 'missing-id.html'), 'utf8');
  assert.match(generatedHtml, /id="plotcat-exercise-1"/);

  const two = render('two-chunks.qmd');
  assert.equal(two.status, 0, two.stdout + two.stderr);
  const twoHtml = readFileSync(resolve(output, 'two-chunks.html'), 'utf8');
  assert.match(twoHtml, /id="plotcat-two-r"/);
  assert.match(twoHtml, /&quot;engine&quot;:&quot;r&quot;/);
  assert.doesNotMatch(twoHtml, /&quot;packages&quot;/);
  assert.match(twoHtml, /id="webr-/);
  assert.doesNotMatch(twoHtml, /cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror/);
  assert.doesNotMatch(twoHtml, /main = "Target title"/);

  const multiple = render('multiple.qmd');
  assert.equal(multiple.status, 0, multiple.stdout + multiple.stderr);
  const multipleHtml = readFileSync(resolve(output, 'multiple.html'), 'utf8');
  assert.equal((multipleHtml.match(/class="plotcat plotcat--side-by-side"/g) || []).length, 2);
  assert.equal((multipleHtml.match(/plotcat\.js" type="module"/g) || []).length, 1);

  const nonHtml = render('non-html.qmd');
  assert.equal(nonHtml.status, 0, nonHtml.stdout + nonHtml.stderr);

  const weightsResult = render('weights.qmd');
  assert.equal(weightsResult.status, 0, weightsResult.stdout + weightsResult.stderr);
  const weightsHtml = readFileSync(resolve(output, 'weights.html'), 'utf8');
  const weightsMatch = weightsHtml.match(/data-plotcat-weights="([^"]+)"/);
  assert.ok(weightsMatch, 'data-plotcat-weights attribute not found');
  const decoded = JSON.parse(atob(weightsMatch[1]));
  assert.equal(decoded.svg.geometry, 0.3);
  assert.equal(decoded.svg.text, 0.5);
  assert.equal(decoded.svg.style, 0.1);
  assert.equal(decoded.svg.frame, 0.15);

  const fmWeights = render('weights-frontmatter.qmd');
  assert.equal(fmWeights.status, 0, fmWeights.stdout + fmWeights.stderr);
  const fmHtml = readFileSync(resolve(output, 'weights-frontmatter.html'), 'utf8');
  const fmMatch = fmHtml.match(/data-plotcat-weights="([^"]+)"/);
  assert.ok(fmMatch, 'data-plotcat-weights attribute not found');
  const fmDecoded = JSON.parse(atob(fmMatch[1]));
  assert.equal(fmDecoded.svg.geometry, 0.7);
  assert.equal(fmDecoded.svg.text, 0.2);
  assert.equal(fmDecoded.svg.style, 0.1);

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
