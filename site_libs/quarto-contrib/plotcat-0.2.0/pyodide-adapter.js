export class PyodideAdapter {
  constructor(load = () => import('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs')) {
    this.load = load;
    this.installed = new Set();
  }

  async init(manifest) {
    const { loadPyodide } = await this.load();
    this.pyodide = await loadPyodide();
    if (manifest && manifest.packages) {
      await this.installPackages(manifest.packages);
    }
  }

  async installPackages(packages) {
    const aliases = { sklearn: 'scikit-learn' };
    const bundledNames = new Set(['matplotlib', 'numpy', 'pandas', 'scikit-learn', 'scipy']);
    const bundled = [];
    const wheels = [];
    for (const name of packages) {
      const normalized = aliases[name] || name;
      if (!this.installed.has(normalized)) {
        (bundledNames.has(normalized) ? bundled : wheels).push(normalized);
      }
    }
    if (bundled.length) {
      await this.pyodide.loadPackage(bundled);
      bundled.forEach(name => this.installed.add(name));
      if (bundled.includes('matplotlib')) {
        await this.pyodide.runPythonAsync("import matplotlib; matplotlib.use('SVG')");
      }
    }
    if (wheels.length) {
      await this.pyodide.loadPackage('micropip');
      await this.pyodide.pyimport('micropip').install(wheels);
      wheels.forEach(name => this.installed.add(name));
    }
  }
  async renderSvg(code, options = {}) {
    const width = options.width || 6.4;
    const height = options.height || 4.8;
const wrapped = `import ast
import contextlib
import io
import json
import matplotlib
matplotlib.use('SVG')
import matplotlib.pyplot as plt
plt.close('all')
_plotcat_globals = {'__builtins__': __builtins__}
_plotcat_result = None
_plotcat_console = io.StringIO()
with contextlib.redirect_stdout(_plotcat_console), contextlib.redirect_stderr(_plotcat_console):
    _plotcat_tree = ast.parse(${JSON.stringify(code)})
    if _plotcat_tree.body and isinstance(_plotcat_tree.body[-1], ast.Expr):
        _plotcat_last = ast.Expression(_plotcat_tree.body.pop().value)
        exec(compile(_plotcat_tree, '<plotcat>', 'exec'), _plotcat_globals)
        _plotcat_result = eval(compile(_plotcat_last, '<plotcat>', 'eval'), _plotcat_globals)
        if _plotcat_result is not None:
            print(repr(_plotcat_result))
    else:
        exec(compile(_plotcat_tree, '<plotcat>', 'exec'), _plotcat_globals)
if _plotcat_result is None:
    _plotcat_result = next((value for value in reversed(tuple(_plotcat_globals.values())) if type(value).__module__.startswith('plotnine') and hasattr(value, 'draw')), None)

if _plotcat_result is not None and type(_plotcat_result).__module__.startswith('plotly') and hasattr(_plotcat_result, 'to_json'):
    _plotcat_out = '{"type":"plotly","data":' + _plotcat_result.to_json() + '}'
else:
    if hasattr(_plotcat_result, 'savefig'):
        _plotcat_figure = _plotcat_result
    elif type(_plotcat_result).__module__.startswith('plotnine') and hasattr(_plotcat_result, 'draw'):
        _plotcat_figure = _plotcat_result.draw()
    elif plt.get_fignums():
        _plotcat_figure = plt.gcf()
    else:
        _plotcat_out = json.dumps({'type': 'no-plot', 'output': _plotcat_console.getvalue()})
    if '_plotcat_figure' in globals():
        _plotcat_figure.set_size_inches(${width}, ${height})
        _plotcat_buffer = io.StringIO()
        _plotcat_figure.savefig(_plotcat_buffer, format='svg')
        _plotcat_out = _plotcat_buffer.getvalue()
        plt.close('all')
_plotcat_out`;
    try {
      const result = await this.pyodide.runPythonAsync(wrapped);
      const output = String(result);
      if (output.startsWith('{"type": "no-plot"')) {
        const details = JSON.parse(output);
        const error = new Error('Python code did not produce a plot.');
        error.output = details.output;
        throw error;
      }
      if (!output.includes('<svg') && !output.startsWith('{"type":"plotly"')) {
        throw new Error('Python code did not produce a plot.');
      }
      return output;
    } catch (error) {
      if (error?.output !== undefined) throw error;
      throw new Error(`Python error: ${error instanceof Error ? error.message : error}`);
    }
  }
}
