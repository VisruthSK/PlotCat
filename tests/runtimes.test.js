import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridge, enqueue, isRuntimeProvided, renderOn, renderPlot } from '../_extensions/plotcat/runtimes.js';
import { R_RUNNER } from '../_extensions/plotcat/runtime-r.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
const SIZE = { width: 7, height: 5 };

function fakeR(response) {
  return {
    evalRVoid: async () => {},
    evalRString: async () => response
  };
}

function fakePython(response) {
  return {
    runPythonAsync: async code => code.startsWith('plotcat_render(') ? response : undefined
  };
}

test('R renders SVG returned by the runner, with the code passed as a string literal', async () => {
  const runtime = fakeR(SVG);
  const calls = [];
  runtime.evalRString = async call => { calls.push(call); return SVG; };
  assert.deepEqual(await renderOn('r', runtime, 'plot(cars)', SIZE), { kind: 'svg', svg: SVG });
  assert.deepEqual(calls, ['plotcat_render("plot(cars)", 7, 5)']);
});

test('R plotly output is returned as a figure', async () => {
  const figure = { data: [{ type: 'scatter' }], layout: {} };
  const runtime = fakeR(JSON.stringify({ type: 'plotly', data: figure }));
  assert.deepEqual(await renderOn('r', runtime, 'plotly::plot_ly()', SIZE), { kind: 'plotly', figure });
});

test('R errors and missing plots carry the captured output', async () => {
  const failing = fakeR('{"type":"error","message":"unexpected symbol","output":"hi\\n"}');
  assert.deepEqual(
    await renderOn('r', failing, 'plot(', SIZE),
    { kind: 'error', message: 'unexpected symbol', output: 'hi\n' }
  );
  const noPlot = await renderOn('r', fakeR('{"type":"no-plot","output":"[1] 2\\n"}'), '1 + 1', SIZE);
  assert.equal(noPlot.kind, 'no-plot');
  assert.equal(noPlot.output, '[1] 2\n');
  assert.match(noPlot.message, /plot\(\), ggplot\(\), tinyplot\(\)/);
});

test('Python renders SVG, reports plotly, no-plot, and error results', async () => {
  assert.deepEqual(await renderOn('python', fakePython(SVG), 'fig, ax = plt.subplots()', SIZE), { kind: 'svg', svg: SVG });

  const figure = { data: [], layout: {} };
  assert.deepEqual(
    await renderOn('python', fakePython(JSON.stringify({ type: 'plotly', data: figure })), 'go.Figure()', SIZE),
    { kind: 'plotly', figure }
  );

  const noPlot = await renderOn('python', fakePython('{"type": "no-plot", "output": "hello\\n"}'), 'print("hello")', SIZE);
  assert.equal(noPlot.kind, 'no-plot');
  assert.equal(noPlot.output, 'hello\n');
  assert.match(noPlot.message, /plt\.plot\(\), ggplot\(\), go\.Figure\(\)/);

  assert.deepEqual(
    await renderOn('python', fakePython('{"type": "error", "message": "NameError: x", "output": ""}'), 'x', SIZE),
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

test('a runtime is reported as provided only after the bridge receives it', async () => {
  assert.equal(isRuntimeProvided('python'), false);
  bridge.provide('python', Promise.resolve(fakePython(SVG)));
  assert.equal(isRuntimeProvided('python'), true);
  assert.deepEqual(await renderPlot('python', 'fig', SIZE), { kind: 'svg', svg: SVG });
});

test('a runtime that fails to start rejects the render with its own error', async () => {
  bridge.provide('r', Promise.reject(new Error('webR could not start')));
  assert.equal(isRuntimeProvided('r'), true);
  await assert.rejects(renderPlot('r', 'plot(cars)', SIZE), /webR could not start/);
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
