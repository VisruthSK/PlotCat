import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRAdapter } from '../_extensions/plotcat/webr-adapter.js';
import { PyodideAdapter } from '../_extensions/plotcat/pyodide-adapter.js';
import { comparePlotly } from '../_extensions/plotcat/svg.js';

function mockWebR(overrides = {}) {
  const calls = { init: 0, code: '', ...overrides.calls };
  class WebR {
    FS = overrides.FS || { readFile: async () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>') };
    async init() { calls.init++; }
    async evalRVoid(code) { calls.code = code; }
  }
  return { WebR, calls };
}

test('WebR returns SVG bytes', async () => {
  const { WebR, calls } = mockWebR();
  const webR = new WebR();
  await webR.init();
  const adapter = new WebRAdapter(Promise.resolve(webR));
  await adapter.init();
  const svg = await adapter.renderSvg('plot(cars)');
  assert.equal(calls.init, 1);
  assert.match(calls.code, /new\.env\(parent = globalenv\(\)\)/);
  assert.match(calls.code, /svglite::svglite\(/);
  assert.match(calls.code, /requireNamespace\("svglite"/);
  assert.match(calls.code, /withVisible\(eval\(parse/);
  assert.match(calls.code, /sink\(/);
  assert.match(calls.code, /print\(val\)/);
  assert.match(calls.code, /plot\(cars\)/);
  assert.match(svg, /^<svg/);
});

test('WebR adapter does not initialize the provided WebR instance', async () => {
  const { WebR, calls } = mockWebR();
  const existing = new WebR();
  await existing.init();
  const adapter = new WebRAdapter(Promise.resolve(existing));
  await adapter.init();
  assert.equal(calls.init, 1, 'should not re-initialize the provided WebR instance');
  const svg = await adapter.renderSvg('plot(cars)');
  assert.match(svg, /^<svg/);
});

test('WebR reports runtime and invalid-output errors with language context', async () => {
  class BrokenWebR {
    FS = { readFile: async path => {
      if (path === '/tmp/plotcat-plotly.json') throw new Error('File not found');
      return new TextEncoder().encode(path.endsWith('.txt') ? '[1] 2\n' : '<svg xmlns="http://www.w3.org/2000/svg"/>');
    } };
    async init() {}
    async evalRVoid() {}
  }
  const adapter = new WebRAdapter(Promise.resolve(new BrokenWebR()));
  await adapter.init();
  await assert.rejects(adapter.renderSvg('1 + 1'), error => error.message === 'R code did not produce a plot.' && error.output === '[1] 2\n');
  adapter.webR.evalRVoid = async () => { throw new Error('unexpected symbol'); };
  await assert.rejects(adapter.renderSvg('plot('), /R error: unexpected symbol/);
});

test('Pyodide captures an isolated final plot expression', async () => {
  const calls = {
    code: ''
  };
  const pyodide = {
    runPythonAsync: async code => {
      calls.code = code;
      return '<svg xmlns="http://www.w3.org/2000/svg"/>';
    }
  };
  const adapter = new PyodideAdapter(Promise.resolve(pyodide));
  await adapter.init();
  const svg = await adapter.renderSvg('fig, ax = plt.subplots()');
  assert.match(calls.code, /_plotcat_globals = \{'__builtins__': __builtins__\}/);
  assert.match(calls.code, /_plotcat_console = io\.StringIO\(\)/);
  assert.match(calls.code, /isinstance\(_plotcat_tree\.body\[-1\], ast\.Expr\)/);
  assert.match(calls.code, /type\(_plotcat_result\)\.__module__\.startswith\('plotnine'\)/);
  assert.match(calls.code, /_plotcat_result\.draw\(\)/);
  assert.match(calls.code, /_plotcat_plt\.close\(/);
  assert.match(svg, /^<svg/);
});

test('Pyodide reports Python failures and missing plots clearly', async () => {
  const pyodide = { runPythonAsync: async () => '{"type": "no-plot", "output": "hello\\n"}' };
  const adapter = new PyodideAdapter(Promise.resolve(pyodide)); await adapter.init();
  await assert.rejects(adapter.renderSvg('print("hello")'), error => error.message === 'Python code did not produce a plot.' && error.output === 'hello\n');
  pyodide.runPythonAsync = async () => 'not svg';
  await assert.rejects(adapter.renderSvg('x = 1'), /Python error: Python code did not produce a plot/);
  pyodide.runPythonAsync = async () => { throw new Error('NameError: x'); };
  await assert.rejects(adapter.renderSvg('x'), /Python error: NameError: x/);
});

test('Pyodide does not leak previous plot between executions', async () => {
  let callCount = 0;
  const pyodide = {
    runPythonAsync: async code => {
      callCount++;
      if (callCount === 1) {
        return '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
      }
      return '{"type": "no-plot", "output": "no plot\\n"}';
    }
  };
  const adapter = new PyodideAdapter(Promise.resolve(pyodide));
  await adapter.init();

  const first = await adapter.renderSvg(`
import matplotlib.pyplot as plt
plt.plot([1, 2], [3, 4])
`);
  assert.match(first, /<svg/);

  await assert.rejects(
    () => adapter.renderSvg('print("no plot")'),
    /Python code did not produce a plot/
  );
});

test('comparePlotly evaluates data, types, styling, and layout variables', () => {
  const target = {
    data: [{
      type: 'scatter',
      x: [1, 2, 3],
      y: [4, 5, 6],
      mode: 'markers',
      marker: { color: 'red', size: 10 }
    }],
    layout: {
      title: { text: 'My Title' },
      xaxis: { title: { text: 'X Axis' } }
    }
  };

  const matchResult = comparePlotly(target, target);
  assert.equal(matchResult.score, 1.0);
  assert.deepEqual(matchResult.feedback, ['Excellent recreation!']);

  const student = {
    data: [{
      type: 'scatter',
      x: [1, 2, 3],
      y: [4, 5, 6],
      mode: 'markers',
      marker: { color: 'blue', size: 10 }
    }],
    layout: {
      title: { text: 'Wrong Title' },
      xaxis: { title: { text: 'X Axis' } }
    }
  };
  const diffResult = comparePlotly(target, student);
  assert.ok(diffResult.score < 1.0);
  assert.ok(diffResult.feedback.some(f => f.includes('Layout title expected')));
});
