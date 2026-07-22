import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRAdapter } from '../_extensions/plotcat/webr-adapter.js';
import { PyodideAdapter } from '../_extensions/plotcat/pyodide-adapter.js';
import { comparePlotly } from '../_extensions/plotcat/svg.js';

test('WebR initializes once, installs declared packages, and returns SVG bytes', async () => {
  const calls = { init: 0, packages: [], code: '' };
  class WebR {
    FS = { readFile: async () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>') };
    async init() { calls.init++; }
    async installPackages(packages) { calls.packages.push(packages); }
    async evalRVoid(code) { calls.code = code; }
  }
  const adapter = new WebRAdapter(async () => ({ WebR }));
  await adapter.init({ packages: ['tinyplot', 'ggplot2'] });
  const svg = await adapter.renderSvg('plot(cars)');
  assert.equal(calls.init, 1);
  assert.deepEqual(calls.packages, [['svglite'], ['tinyplot'], ['ggplot2']]);
  assert.match(calls.code, /new\.env\(parent = globalenv\(\)\)/);
  assert.match(calls.code, /svglite::svglite\(/);
  assert.match(calls.code, /withVisible\(eval\(parse/);
  assert.match(calls.code, /sink\(/);
  assert.match(calls.code, /print\(val\)/);
  assert.match(calls.code, /plot\(cars\)/);
  assert.match(svg, /^<svg/);
});

test('WebR reports runtime and invalid-output errors with language context', async () => {
  class BrokenWebR {
    FS = { readFile: async path => new TextEncoder().encode(path.endsWith('.txt') ? '[1] 2\n' : '<svg xmlns="http://www.w3.org/2000/svg"/>') };
    async init() {}
    async installPackages() {}
    async evalRVoid() {}
  }
  const adapter = new WebRAdapter(async () => ({ WebR: BrokenWebR })); await adapter.init({ packages: [] });
  await assert.rejects(adapter.renderSvg('1 + 1'), error => error.message === 'R code did not produce a plot.' && error.output === '[1] 2\n');
  adapter.webR.evalRVoid = async () => { throw new Error('unexpected symbol'); };
  await assert.rejects(adapter.renderSvg('plot('), /R error: unexpected symbol/);
});

test('Pyodide installs import aliases and captures an isolated final plot expression', async () => {
  const calls = { loaded: [], installed: [], code: '' };
  const pyodide = {
    loadPackage: async name => calls.loaded.push(name),
    pyimport: () => ({ install: async packages => calls.installed.push(packages) }),
    runPythonAsync: async code => { calls.code = code; return '<svg xmlns="http://www.w3.org/2000/svg"/>'; }
  };
  const adapter = new PyodideAdapter(async () => ({ loadPyodide: async () => pyodide }));
  await adapter.init({ packages: ['matplotlib', 'sklearn', 'plotnine'] });
  const svg = await adapter.renderSvg('fig, ax = plt.subplots()');
  assert.deepEqual(calls.loaded, [['matplotlib', 'scikit-learn'], 'micropip']);
  assert.deepEqual(calls.installed, [['plotnine']]);
  assert.match(calls.code, /_plotcat_globals = \{'__builtins__': __builtins__\}/);
  assert.match(calls.code, /isinstance\(_plotcat_tree\.body\[-1\], ast\.Expr\)/);
  assert.match(calls.code, /type\(_plotcat_result\)\.__module__\.startswith\('plotnine'\)/);
  assert.match(calls.code, /_plotcat_result\.draw\(\)/);
  assert.match(calls.code, /plt\.close\('all'\)/);
  assert.match(svg, /^<svg/);
});

test('Pyodide reports Python failures and missing plots clearly', async () => {
  const pyodide = { loadPackage: async () => {}, pyimport: () => ({ install: async () => {} }), runPythonAsync: async () => 'not svg' };
  const adapter = new PyodideAdapter(async () => ({ loadPyodide: async () => pyodide })); await adapter.init({ packages: [] });
  await assert.rejects(adapter.renderSvg('x = 1'), /Python error: Python code did not produce a plot/);
  pyodide.runPythonAsync = async () => { throw new Error('NameError: x'); };
  await assert.rejects(adapter.renderSvg('x'), /Python error: NameError: x/);
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
