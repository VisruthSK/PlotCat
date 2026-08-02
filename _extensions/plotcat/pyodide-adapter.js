import { errorMessage } from './utils.js';

export class PyodideAdapter {
  constructor(pyodidePromise) {
    this.pyodidePromise = pyodidePromise;
  }

  async init() {
    this.pyodide = await this.pyodidePromise;
  }

  async renderSvg(code, options = {}) {
    const width = options.width || 7;
    const height = options.height || 5;
    const wrapped = `import ast
import contextlib
import io
import json
import sys

_plotcat_plt = sys.modules.get("matplotlib.pyplot")

if _plotcat_plt is not None:
    _plotcat_plt.close("all")

_plotcat_globals = {'__builtins__': __builtins__}
_plotcat_result = None
_plotcat_figure = None
_plotcat_out = None
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
    _plotcat_plt = sys.modules.get("matplotlib.pyplot")
    if hasattr(_plotcat_result, 'savefig'):
        _plotcat_figure = _plotcat_result
    elif type(_plotcat_result).__module__.startswith('plotnine') and hasattr(_plotcat_result, 'draw'):
        _plotcat_figure = _plotcat_result.draw()
    elif _plotcat_plt is not None and _plotcat_plt.get_fignums():
        _plotcat_figure = _plotcat_plt.gcf()
    else:
        _plotcat_out = json.dumps({'type': 'no-plot', 'output': _plotcat_console.getvalue()})
    if _plotcat_figure is not None:
        _plotcat_figure.set_size_inches(${width}, ${height})
        _plotcat_buffer = io.StringIO()
        _plotcat_figure.savefig(_plotcat_buffer, format='svg')
        _plotcat_out = _plotcat_buffer.getvalue()
        if _plotcat_plt is not None:
            _plotcat_plt.close('all')
_plotcat_out`;
    try {
      const result = await this.pyodide.runPythonAsync(wrapped);
      const output = String(result);
      if (output.startsWith('{"type": "no-plot"')) {
        return { kind: 'no-plot', message: 'Python code did not produce a plot. Make sure the last expression is a figure (e.g., plt.plot(), ggplot(), go.Figure()).' };
      }
      if (output.startsWith('{"type":"plotly"')) {
        return { kind: 'plotly', figure: JSON.parse(output).data };
      }
      if (output.includes('<svg')) {
        return { kind: 'svg', svg: output };
      }
      return { kind: 'no-plot', message: 'Python code did not produce a plot. Make sure the last expression is a figure (e.g., plt.plot(), ggplot(), go.Figure()).' };
    } catch (error) {
      return { kind: 'error', message: errorMessage(error), traceback: '' };
    }
  }
}
