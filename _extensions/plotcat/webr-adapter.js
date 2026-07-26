export class WebRAdapter {
  constructor(webRPromise) {
    this.webRPromise = webRPromise;
  }

  async init() {
    this.webR = await this.webRPromise;
  }

  async renderSvg(code, options = {}) {
    const width = options.width || 7;
    const height = options.height || 5;
    const path = `/tmp/plotcat-${crypto.randomUUID()}.svg`;
    const outputPath = `/tmp/plotcat-${crypto.randomUUID()}.txt`;
    const source = JSON.stringify(code);
    try {
      await this.webR.evalRVoid(`local({
        if (file.exists("/tmp/plotcat-plotly.json")) file.remove("/tmp/plotcat-plotly.json");
        if (!requireNamespace("svglite", quietly = TRUE)) {
          stop("PlotCat requires the R package 'svglite'. Add it under format.live-html.webr.packages.")
        }
        svglite::svglite(${JSON.stringify(path)}, width = ${width}, height = ${height});
        sink(${JSON.stringify(outputPath)});
        on.exit({ sink(); dev.off() }, add = TRUE);
        plotcat_env <- new.env(parent = globalenv());
        plotcat_result <- withVisible(eval(parse(text = ${source}), envir = plotcat_env));
        if (plotcat_result$visible) {
          val <- plotcat_result$value;
          if (inherits(val, "plotly")) {
            writeLines(paste0('{"type":"plotly","data":', plotly::plotly_json(val, jsonedit = FALSE, pretty = FALSE), '}'), "/tmp/plotcat-plotly.json");
          } else {
            print(val);
          }
        }
      })`);

      let plotlyBytes;
      try {
        plotlyBytes = await this.webR.FS.readFile('/tmp/plotcat-plotly.json');
      } catch {}

      if (plotlyBytes) {
        const raw = new TextDecoder().decode(plotlyBytes);
        return { kind: 'plotly', figure: JSON.parse(raw).data, stdout: [], warnings: [] };
      }

      const svgBytes = await this.webR.FS.readFile(path);
      const svg = new TextDecoder().decode(svgBytes);
      if (!/<(?:circle|line|path|polygon|polyline|rect|text|image|use)\b/.test(svg)) {
        return { kind: 'no-plot', message: 'R code did not produce a plot. Make sure the last expression generates a plot (e.g., plot(), ggplot(), tinyplot()).' };
      }
      return { kind: 'svg', svg, stdout: [], warnings: [] };
    } catch (error) {
      let traceback = '';
      try { traceback = new TextDecoder().decode(await this.webR.FS.readFile(outputPath)); } catch {}
      return { kind: 'error', message: error instanceof Error ? error.message : String(error), traceback };
    } finally {
      if (this.webR?.FS?.unlink) {
        for (const file of [path, outputPath, '/tmp/plotcat-plotly.json']) {
          try { await this.webR.FS.unlink(file); } catch {}
        }
      }
    }
  }
}
