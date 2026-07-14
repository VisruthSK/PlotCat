export class WebRAdapter {
  constructor(load = () => import('https://webr.r-wasm.org/latest/webr.mjs')) {
    this.load = load;
    this.installed = new Set();
  }

  async init(manifest) {
    const { WebR } = await this.load();
    this.webR = new WebR();
    await this.webR.init();
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

  async renderSvg(code) {
    const path = `/tmp/plotcat-${crypto.randomUUID()}.svg`;
    try { await this.webR.evalRVoid(`local({ svg(${JSON.stringify(path)}); on.exit(dev.off()); ${code}\n })`); const bytes = await this.webR.FS.readFile(path); const svg = new TextDecoder().decode(bytes); if (!svg.includes('<svg')) throw new Error('R code did not produce a plot.'); return svg; }
    catch (error) { throw new Error(`R error: ${error instanceof Error ? error.message : error}`); }
  }
}
