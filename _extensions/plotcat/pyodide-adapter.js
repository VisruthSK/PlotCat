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
    const wrapped = `import io\nimport matplotlib.pyplot as plt\nplt.rcParams['figure.figsize'] = [${width}, ${height}]\n${code}\n_buf = io.StringIO()\ntry:\n fig\nexcept NameError:\n fig = plt.gcf()\nfig.set_size_inches(${width}, ${height})\nfig.savefig(_buf, format='svg')\n_buf.getvalue()`;
    try { const svg = await this.pyodide.runPythonAsync(wrapped); if (!String(svg).includes('<svg')) throw new Error('Python code did not produce a plot.'); return String(svg); }
    catch (error) { throw new Error(`Python error: ${error instanceof Error ? error.message : error}`); }
  }
}
