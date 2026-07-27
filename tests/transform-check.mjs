import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const output = resolve('.test-output');
try { rmSync(output, { recursive: true, force: true }); } catch {}

const secondsSince = started => ((performance.now() - started) / 1000).toFixed(1);
const windows = process.platform === 'win32';
const executable = windows ? 'quarto.cmd' : 'quarto';
const renderTimeout = Number(process.env.PLOTCAT_QUARTO_TIMEOUT_MS ?? 90000);

function copyExtensions(dir) {
  cpSync(resolve('_extensions'), resolve(dir, '_extensions'), { recursive: true });
  cpSync(resolve('website/_extensions/r-wasm'), resolve(dir, '_extensions/r-wasm'), { recursive: true });
}

function readFixture(file) {
  return readFileSync(resolve('tests/fixtures', file), 'utf8')
    .replace('../../_extensions/plotcat/plotcat.lua', 'plotcat');
}

function spawnQuarto(args, cwd) {
  return spawnSync(executable, args, { encoding: 'utf8', cwd, shell: windows });
}

try {
  mkdirSync(output, { recursive: true });

  // ── Batch successful fixtures ──────────────────────────────────
  const t0 = performance.now();
  const successDir = resolve(output, 'success');
  mkdirSync(successDir, { recursive: true });
  copyExtensions(successDir);

  const successFixtures = [
    'minimal.qmd',
    'missing-id.qmd',
    'two-chunks.qmd',
    'multiple.qmd',
    'weights.qmd',
    'weights-frontmatter.qmd'
  ];

  for (const fixture of successFixtures) {
    writeFileSync(resolve(successDir, fixture), readFixture(fixture));
  }

  writeFileSync(resolve(successDir, '_quarto.yml'), `project:
  type: default
  output-dir: _output
  render:
${successFixtures.map(f => `    - ${f}`).join('\n')}

format:
  live-html:
    toc: true
`);

  console.log(`TIMING: setup ${secondsSince(t0)}s`);

  const t1 = performance.now();
  const batchResult = spawnQuarto(['render', '--quiet'], successDir);
  assert.equal(batchResult.status, 0, `Batch render failed: ${batchResult.stdout + batchResult.stderr}`);
  console.log(`TIMING: batch render ${secondsSince(t1)}s`);

  const assertionsStarted = performance.now();

  function readGenerated(fixture) {
    const htmlFile = fixture.replace(/\.qmd$/, '.html');
    return readFileSync(resolve(successDir, '_output', htmlFile), 'utf8');
  }

  function assertWeights(html, expected) {
    const match = html.match(/data-plotcat-weights="([^"]+)"/);
    assert.ok(match, `data-plotcat-weights attribute not found`);
    const decoded = JSON.parse(atob(match[1]));
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(decoded.svg[key], value, `Weight mismatch for ${key}`);
    }
  }

  const html = readGenerated('minimal.qmd');
  assert.match(html, /class="plotcat plotcat--side-by-side"/);
  assert.match(html, /data-plotcat-target-code="[A-Za-z0-9+/=]+"/);
  assert.doesNotMatch(html, /data-plotcat-salt=/);
  assert.match(html, /class="plotcat__target-loading"/);
  assert.doesNotMatch(html, /plot\(cars\)/);
  assert.doesNotMatch(html, /plotcat-live-cell/);
  assert.match(html, /type="module"/);

  const generatedHtml = readGenerated('missing-id.qmd');
  assert.match(generatedHtml, /id="plotcat-exercise-1"/);

  const twoHtml = readGenerated('two-chunks.qmd');
  assert.match(twoHtml, /id="plotcat-two-r"/);
  assert.match(twoHtml, /&quot;engine&quot;:&quot;r&quot;/);
  assert.doesNotMatch(twoHtml, /&quot;packages&quot;/);
  assert.match(twoHtml, /id="webr-/);
  assert.doesNotMatch(twoHtml, /cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror/);
  assert.doesNotMatch(twoHtml, /main = "Target title"/);

  const multipleHtml = readGenerated('multiple.qmd');
  assert.equal((multipleHtml.match(/class="plotcat plotcat--side-by-side"/g) || []).length, 2);
  assert.equal((multipleHtml.match(/plotcat\.js" type="module"/g) || []).length, 1);

  assertWeights(readGenerated('weights.qmd'), { geometry: 0.35, text: 0.4, style: 0.1, frame: 0.15 });
  assertWeights(readGenerated('weights-frontmatter.qmd'), { geometry: 0.65, text: 0.1, style: 0.1 });

  console.log(`TIMING: batch assertions ${secondsSince(assertionsStarted)}s`);

  // ── Non-HTML fixture (separate process) ────────────────────────
  const t2 = performance.now();
  const nonHtmlDir = resolve(output, 'non-html');
  mkdirSync(nonHtmlDir, { recursive: true });
  copyExtensions(nonHtmlDir);
  writeFileSync(resolve(nonHtmlDir, 'non-html.qmd'), readFixture('non-html.qmd'));
  const nonHtmlResult = spawnQuarto(['render', 'non-html.qmd'], nonHtmlDir);
  assert.equal(nonHtmlResult.status, 0, nonHtmlResult.stdout + nonHtmlResult.stderr);
  console.log(`TIMING: non-html ${secondsSince(t2)}s`);

  // ── Invalid fixtures (concurrent, concurrency-limited) ─────────
  const t3 = performance.now();
  const invalidFixtures = [
    ['zero-chunks.qmd', 'needs one target chunk'],
    ['too-many.qmd', 'more than two executable chunks'],
    ['mixed.qmd', 'mixes engines'],
    ['invalid-attribute.qmd', "attribute 'title' is not supported; only id, weight, and dimension attributes are allowed"],
    ['executed-starter.qmd', 'starter chunk executed'],
    ['duplicate-id.qmd', "duplicate id 'same'"],
    ['unsupported-engine.qmd', "unsupported engine 'bash'"],
    ['wrong-format.qmd', 'requires format: live-html'],
    ['invalid-weight-sum.qmd', 'SVG weights must sum to 1.0']
  ];

  function renderInvalid(fixture) {
    return new Promise((resolvePromise, reject) => {
      const dir = resolve(output, `invalid-${fixture.replace(/\.qmd$/, '')}`);
      mkdirSync(dir, { recursive: true });
      copyExtensions(dir);
      writeFileSync(resolve(dir, fixture), readFixture(fixture));
      writeFileSync(resolve(dir, '_quarto.yml'), 'format:\n  live-html:\n    toc: true\n');

      const isInteractive = fixture !== 'wrong-format.qmd';
      const args = isInteractive ? ['render', fixture, '--to', 'live-html'] : ['render', fixture];

      const child = spawn(executable, args, { cwd: dir, shell: windows, stdio: ['ignore', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${fixture} timed out after ${renderTimeout}ms`));
      }, renderTimeout);

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolvePromise({ fixture, code, signal, stdout, stderr });
      });
      child.on('error', error => {
        clearTimeout(timer);
        reject(new Error(`${fixture}: failed to start Quarto: ${error.message}`, { cause: error }));
      });
    });
  }

  async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let nextIndex = 0;

    async function worker() {
      while (true) {
        const index = nextIndex++;
        if (index >= tasks.length) return;
        results[index] = await tasks[index]();
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
    );

    return results;
  }

  const invalidResults = await runWithConcurrency(
    invalidFixtures.map(([fixture, _message]) => () => renderInvalid(fixture)),
    3
  );
  assert.equal(invalidResults.length, invalidFixtures.length);

  for (const { fixture, code, signal, stdout, stderr } of invalidResults) {
    const entry = invalidFixtures.find(([f]) => f === fixture);
    const message = entry[1];
    assert.notEqual(code, 0, `${fixture} unexpectedly rendered`);
    assert.equal(signal, null, `${fixture} was terminated by signal ${signal}`);
    assert.match(stdout + stderr, new RegExp(message), `${fixture} missing expected diagnostic "${message}"`);
  }

  console.log(`TIMING: invalid fixtures ${secondsSince(t3)}s`);

  const t4 = performance.now();

  // ── Static source checks ───────────────────────────────────────
  const lua = await readFile(new URL('../_extensions/plotcat/plotcat.lua', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../_extensions/plotcat/runtime-manager.js', import.meta.url), 'utf8');
  const pyodide = await readFile(new URL('../_extensions/plotcat/pyodide-adapter.js', import.meta.url), 'utf8');
  const webr = await readFile(new URL('../_extensions/plotcat/webr-adapter.js', import.meta.url), 'utf8');

  assert.doesNotMatch(lua, /packages_for/);
  assert.doesNotMatch(lua, /packages\s*=/);
  assert.doesNotMatch(runtime, /manifest\.packages/);
  assert.doesNotMatch(runtime, /installPackages/);
  assert.doesNotMatch(pyodide, /micropip|pyimport|loadPackage/);
  assert.doesNotMatch(webr, /installPackages/);

  console.log(`TIMING: static checks ${secondsSince(t4)}s`);
  console.log(`TIMING: total ${secondsSince(t0)}s`);
} finally {
  try { rmSync(output, { recursive: true, force: true }); } catch {}
}
