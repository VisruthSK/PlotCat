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
    const toInstall = [];
    for (const name of packages) {
      const normalized = aliases[name] || name;
      if (!this.installed.has(normalized)) {
        toInstall.push(normalized);
        this.installed.add(normalized);
      }
    }
    if (toInstall.length) {
      await this.pyodide.loadPackage('micropip');
      await this.pyodide.pyimport('micropip').install(toInstall);
    }
  }
  async renderSvg(code, options = {}) {
    const width = options.width || 6.4;
    const height = options.height || 4.8;
    const wrapped = `import ast\nimport io\nimport matplotlib.pyplot as plt\nplt.close('all')\n_plotcat_globals = {'__builtins__': __builtins__}\n_plotcat_tree = ast.parse(${JSON.stringify(code)})\n_plotcat_result = None\nif _plotcat_tree.body and isinstance(_plotcat_tree.body[-1], ast.Expr):\n    _plotcat_last = ast.Expression(_plotcat_tree.body.pop().value)\n    exec(compile(_plotcat_tree, '<plotcat>', 'exec'), _plotcat_globals)\n    _plotcat_result = eval(compile(_plotcat_last, '<plotcat>', 'eval'), _plotcat_globals)\nelse:\n    exec(compile(_plotcat_tree, '<plotcat>', 'exec'), _plotcat_globals)\nif _plotcat_result is None:\n    _plotcat_result = next((value for value in reversed(tuple(_plotcat_globals.values())) if type(value).__module__.startswith('plotnine') and hasattr(value, 'draw')), None)\nif hasattr(_plotcat_result, 'savefig'):\n    _plotcat_figure = _plotcat_result\nelif type(_plotcat_result).__module__.startswith('plotnine') and hasattr(_plotcat_result, 'draw'):\n    _plotcat_figure = _plotcat_result.draw()\nelse:\n    _plotcat_figure = plt.gcf()\n_plotcat_figure.set_size_inches(${width}, ${height})\n_plotcat_buffer = io.StringIO()\n_plotcat_figure.savefig(_plotcat_buffer, format='svg')\n_plotcat_svg = _plotcat_buffer.getvalue()\nplt.close('all')\n_plotcat_svg`;
    try { const svg = await this.pyodide.runPythonAsync(wrapped); if (!String(svg).includes('<svg')) throw new Error('Python code did not produce a plot.'); return String(svg); }
    catch (error) { throw new Error(`Python error: ${error instanceof Error ? error.message : error}`); }
  }
}
