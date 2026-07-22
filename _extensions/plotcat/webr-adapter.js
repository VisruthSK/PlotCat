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
    const outputPath = `/tmp/plotcat-${crypto.randomUUID()}.txt`;
    const source = JSON.stringify(code);
    try {
      await this.webR.evalRVoid(`local({
        if (file.exists("/tmp/plotcat-plotly.json")) file.remove("/tmp/plotcat-plotly.json");
        svglite::svglite(${JSON.stringify(path)}, width = ${width}, height = ${height});
        sink(${JSON.stringify(outputPath)});
        on.exit({ sink(); dev.off() }, add = TRUE);
        plotcat_env <- new.env(parent = globalenv());
        plotcat_result <- withVisible(eval(parse(text = ${source}), envir = plotcat_env));
        if (plotcat_result$visible) {
          val <- plotcat_result$value;
          if (inherits(val, "plotly")) {
            writeLines(paste0('{"type":"plotly","data":', plotly:::to_JSON(plotly::plotly_build(val)), '}'), "/tmp/plotcat-plotly.json");
          } else {
            print(val);
          }
        }
      })`);
      try {
        const bytes = await this.webR.FS.readFile('/tmp/plotcat-plotly.json');
        await this.webR.FS.unlink('/tmp/plotcat-plotly.json');
        return new TextDecoder().decode(bytes);
      } catch (e) {
        const bytes = await this.webR.FS.readFile(path);
        const svg = new TextDecoder().decode(bytes);
        if (!/<(?:circle|line|path|polygon|polyline|rect|text|image|use)\b/.test(svg)) {
          const output = new TextDecoder().decode(await this.webR.FS.readFile(outputPath));
          const error = new Error('R code did not produce a plot.');
          error.output = output;
          throw error;
        }
        return svg;
      }
    } catch (error) {
      if (error?.output !== undefined) throw error;
      throw new Error(`R error: ${error instanceof Error ? error.message : error}`);
    }
  }
}
