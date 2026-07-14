export class PyodideAdapter {
  constructor(load = () => import('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs')) {
    this.load = load;
  }

  async init(manifest) {
    const { loadPyodide } = await this.load();
    this.pyodide = await loadPyodide();
    const aliases = { sklearn: 'scikit-learn' };
    const packages = (manifest.packages || []).map(name => aliases[name] || name);
    if (packages.length) { await this.pyodide.loadPackage('micropip'); await this.pyodide.pyimport('micropip').install(packages); }
  }
  async renderSvg(code) {
    const wrapped = `import io\n${code}\n_buf = io.StringIO()\ntry:\n fig\nexcept NameError:\n import matplotlib.pyplot as plt\n fig = plt.gcf()\nfig.savefig(_buf, format='svg')\n_buf.getvalue()`;
    try { const svg = await this.pyodide.runPythonAsync(wrapped); if (!String(svg).includes('<svg')) throw new Error('Python code did not produce a plot.'); return String(svg); }
    catch (error) { throw new Error(`Python error: ${error instanceof Error ? error.message : error}`); }
  }
}
