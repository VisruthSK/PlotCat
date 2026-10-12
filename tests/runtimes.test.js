import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, enqueue, renderOn } from '../_extensions/plotcat/runtimes.js';
import { R_RUNNER } from '../_extensions/plotcat/runtime-r.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';

function rRuntime(response) {
  const calls = { setup: '', call: '' };
  return {
    calls,
    runtime: {
      evalRVoid: async code => { calls.setup = code; },
      evalRString: async call => { calls.call = call; return response; }
    }
  };
}

function pythonRuntime(response) {
  const calls = { setup: '', call: '' };
  return {
    calls,
    runtime: {
      runPythonAsync: async code => {
        if (code.includes('def plotcat_render')) calls.setup = code;
        else { calls.call = code; return response; }
      }
    }
  };
}

test('R runner is installed once and renders SVG held in memory', async () => {
  const { runtime, calls } = rRuntime(SVG);
  await ENGINES.r.setup(runtime);
  assert.match(calls.setup, /svglite::svgstring\(/);
  assert.doesNotMatch(calls.setup, /\/tmp|tempfile/);
  assert.match(calls.setup, /plotcat_render <- function\(code, width, height\)/);
  const result = await renderOn('r', runtime, 'plot(cars)', { width: 7, height: 5 });
  assert.deepEqual(result, { kind: 'svg', svg: SVG });
  assert.equal(calls.call, 'plotcat_render("plot(cars)", 7, 5)');
});

test('R plotly output is returned as a figure', async () => {
  const figure = { data: [{ type: 'scatter' }], layout: {} };
  const { runtime } = rRuntime(JSON.stringify({ type: 'plotly', data: figure }));
  const result = await renderOn('r', runtime, 'plotly::plot_ly()', { width: 7, height: 5 });
  assert.deepEqual(result, { kind: 'plotly', figure });
});

test('R errors and missing plots carry the captured output', async () => {
  const error = rRuntime('{"type":"error","message":"unexpected symbol","output":"hi\\n"}');
  assert.deepEqual(
    await renderOn('r', error.runtime, 'plot(', { width: 7, height: 5 }),
    { kind: 'error', message: 'unexpected symbol', output: 'hi\n' }
  );
  const noPlot = rRuntime('{"type":"no-plot","output":"[1] 2\\n"}');
  const result = await renderOn('r', noPlot.runtime, '1 + 1', { width: 7, height: 5 });
  assert.equal(result.kind, 'no-plot');
  assert.match(result.message, /plot\(\), ggplot\(\), tinyplot\(\)/);
});

test('Python runner is installed once and renders SVG per call', async () => {
  const { runtime, calls } = pythonRuntime(SVG);
  await ENGINES.python.setup(runtime);
  assert.match(calls.setup, /def plotcat_render\(code, width, height\)/);
  assert.match(calls.setup, /namespace = \{"__builtins__": __builtins__\}/);
  assert.match(calls.setup, /result\.draw\(\)/);
  const result = await renderOn('python', runtime, 'fig, ax = plt.subplots()', { width: 7, height: 5 });
  assert.deepEqual(result, { kind: 'svg', svg: SVG });
  assert.equal(calls.call, 'plotcat_render("fig, ax = plt.subplots()", 7, 5)');
});

test('Python no-plot and error results are reported with context', async () => {
  const noPlot = pythonRuntime('{"type": "no-plot", "output": "hello\\n"}');
  const result = await renderOn('python', noPlot.runtime, 'print("hello")', { width: 7, height: 5 });
  assert.equal(result.kind, 'no-plot');
  assert.match(result.message, /plt\.plot\(\), ggplot\(\), go\.Figure\(\)/);
  assert.equal(result.output, 'hello\n');

  const failed = pythonRuntime('{"type": "error", "message": "NameError: x", "output": ""}');
  assert.deepEqual(
    await renderOn('python', failed.runtime, 'x', { width: 7, height: 5 }),
    { kind: 'error', message: 'NameError: x', output: '' }
  );
});

test('engine queues run in order and survive failures', async () => {
  const order = [];
  const one = enqueue('r', async () => { order.push('one'); throw new Error('bad code'); });
  const two = enqueue('r', async () => order.push('two'));
  await assert.rejects(one, /bad code/);
  await two;
  assert.deepEqual(order, ['one', 'two']);
});

test('different engine queues run independently', async () => {
  const order = [];
  let releaseR;
  const rGate = new Promise(resolve => { releaseR = resolve; });
  const r = enqueue('r', async () => { order.push('r-start'); await rGate; order.push('r-end'); });
  await enqueue('python', async () => { order.push('python'); });
  assert.deepEqual(order, ['r-start', 'python']);
  releaseR();
  await r;
  assert.deepEqual(order, ['r-start', 'python', 'r-end']);
});

test('R runner returns a complete SVG document when R is installed', async t => {
  const rscript = process.env.RSCRIPT || 'Rscript';
  const probe = spawnSync(rscript, ['-e', 'quit(status = !requireNamespace("svglite", quietly = TRUE))'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('Rscript with svglite is not available');
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'plotcat-runner-'));
  const script = join(dir, 'runner.R');
  await writeFile(script, `${R_RUNNER}\ncat(plotcat_render("plot(cars)", 7, 5))\n`);
  const result = spawnSync(rscript, [script], { encoding: 'utf8' });
  await rm(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^<\?xml/);
  assert.match(result.stdout.trimEnd(), /<\/svg>$/);
});
