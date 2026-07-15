export class WebRAdapter {
  constructor(load = () => import('https://webr.r-wasm.org/latest/webr.mjs')) {
    this.load = load;
    this.installed = new Set();
  }

  async init(manifest) {
    const { WebR } = await this.load();
    this.webR = new WebR();
    await this.webR.init();
    await this.installPackages(['svglite']);
    if (manifest && manifest.packages) {
      await this.installPackages(manifest.packages);
    }
  }

  async installPackages(packages) {
    for (const pkg of packages) {
      if (!this.installed.has(pkg)) {
        await this.webR.installPackages([pkg]);
        this.installed.add(pkg);
      }
    }
  }

  async renderSvg(code, options = {}) {
    const width = options.width || 7;
    const height = options.height || 7;
    const path = `/tmp/plotcat-${crypto.randomUUID()}.svg`;
    const source = JSON.stringify(code);
    try { await this.webR.evalRVoid(`local({ svglite::svglite(${JSON.stringify(path)}, width = ${width}, height = ${height}); on.exit(dev.off()); plotcat_env <- new.env(parent = globalenv()); plotcat_result <- withVisible(eval(parse(text = ${source}), envir = plotcat_env)); if (plotcat_result$visible && inherits(plotcat_result$value, "ggplot")) print(plotcat_result$value) })`); const bytes = await this.webR.FS.readFile(path); const svg = new TextDecoder().decode(bytes); if (!svg.includes('<svg')) throw new Error('R code did not produce a plot.'); return svg; }
    catch (error) { throw new Error(`R error: ${error instanceof Error ? error.message : error}`); }
  }
}
