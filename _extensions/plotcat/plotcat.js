import { compareSvgFeatures, extractFeatures, sanitizeSvg, scopeSvgIds, comparePlotly } from './svg.js';
import { runtimeManager } from './runtime-manager.js';

async function withRetry(fn, retries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt > retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

let plotlyPromise;

function loadPlotly() {
  if (window.Plotly) {
    return Promise.resolve(window.Plotly);
  }

  if (!plotlyPromise) {
    plotlyPromise = withRetry(() => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.plot.ly/plotly-3.6.0.min.js';
      script.onload = () => resolve(window.Plotly);
      script.onerror = () => reject(new Error(
        'Could not load Plotly from the CDN. Check your internet connection ' +
        'and any network restrictions. Plotly exercises need access to ' +
        'https://cdn.plot.ly/plotly-3.6.0.min.js.'
      ));
      document.head.appendChild(script);
    })).catch(error => {
      plotlyPromise = undefined;
      throw error;
    });
  }

  return plotlyPromise;
}

function decodeTarget(encoded) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function setMode(root, mode) {
  root.classList.remove('plotcat--side-by-side', 'plotcat--overlay', 'plotcat--wipe');
  root.classList.add(`plotcat--${mode}`);
}

function limitPlotlyToSideBySide(root) {
  root.querySelector('input[value="side-by-side"]').checked = true;
  root.querySelectorAll('input[value="overlay"], input[value="wipe"]').forEach(input => {
    input.disabled = true;
    input.closest('label').title = 'Overlay and wipe are unavailable for Plotly charts.';
  });
  setMode(root, 'side-by-side');
}

function svgFragment(svg) {
  return document.createRange().createContextualFragment(svg);
}

function studentCode(root) {
  const editor = root.querySelector(
    '.plotcat__editor .cm-content'
  );

  if (!editor) {
    throw new Error(
      "PlotCat could not find Quarto Live's code editor. " +
      "Ensure Quarto Live is installed and use `format: live-html`."
    );
  }

  return editor.innerText;
}

function renderPlotly(target, figure) {
  const previous = target.querySelector('.js-plotly-plot');
  if (previous && window.Plotly) {
    window.Plotly.purge(previous);
  }
  target.replaceChildren();
  target.style.height = '280px';
  const div = document.createElement('div');
  div.style.width = '100%';
  div.style.height = '100%';
  div.style.alignSelf = 'stretch';
  div.style.flexGrow = '1';
  target.appendChild(div);
  return Plotly.newPlot(div, figure.data, figure.layout, { responsive: true, displayModeBar: false });
}

export function mountPlotCat(root, manager = runtimeManager) {
  if (!manager || typeof manager.get !== 'function') {
    manager = runtimeManager;
  }
  const manifest = JSON.parse(root.dataset.plotcatManifest);
  const adapterPromise = manager.get(manifest.engine);
  adapterPromise.catch(() => {});

  const weights = JSON.parse(atob(root.dataset.plotcatWeights));
  const run = root.querySelector('[data-plotcat-run]');
  const status = root.querySelector('.plotcat__status');
  const target = root.querySelector('[data-plotcat-target]');
  const student = root.querySelector('[data-plotcat-student]');

  const targetCodeBase64 = root.dataset.plotcatTargetCode;
  const svgPrefix = (root.id || manifest.id || 'plotcat').replace(/[^a-zA-Z0-9_-]/g, '-');

  let width = manifest.width || 7;
  let height = manifest.height || 5;

  let targetSvg = null;
  let targetFeatures = null;
  let targetFigure = null;
  let outputType = null;

  async function renderTarget() {
    const targetCode = decodeTarget(targetCodeBase64);
    const adapter = await adapterPromise;

    status.textContent = 'Rendering target…';
    const result = await manager.run(manifest.engine, () => adapter.renderSvg(targetCode, { width, height }));

    if (result.kind === 'plotly') {
      outputType = 'plotly';
      targetFigure = result.figure;
      status.textContent = 'Loading Plotly…';
      await loadPlotly();
      limitPlotlyToSideBySide(root);
      await renderPlotly(target, targetFigure);
    } else if (result.kind === 'svg') {
      outputType = 'svg';
      targetSvg = sanitizeSvg(result.svg);
      targetFeatures = extractFeatures(targetSvg);
      target.replaceChildren(svgFragment(scopeSvgIds(targetSvg, `${svgPrefix}-target`)));
    } else {
      throw new Error(result.message);
    }
  }

  if (targetCodeBase64) {
    run.disabled = true;
    status.textContent = `Loading ${manifest.engine === 'r' ? 'WebR' : 'Pyodide'}…`;
    renderTarget()
      .then(() => { status.textContent = ''; run.disabled = false; })
      .catch(error => {
        console.error('Failed to render target plot:', error);
        const msg = error.message || String(error);
        if (msg.includes('requireNamespace') || msg.includes('package')) {
          status.textContent = msg + ' Required R packages must be listed under `format.live-html.webr.packages` in your Quarto config.';
        } else {
          status.textContent = 'Error rendering target: ' + msg;
        }
        root.classList.add('plotcat--error');
      });
  } else {
    const targetSvgEl = target.querySelector('svg');
    if (targetSvgEl) {
      outputType = 'svg';
      targetSvg = sanitizeSvg(targetSvgEl.outerHTML);
      targetFeatures = extractFeatures(targetSvg);
      target.replaceChildren(svgFragment(scopeSvgIds(targetSvg, `${svgPrefix}-target`)));
      status.textContent = '';
      run.disabled = false;
    }
  }

  root.querySelectorAll('input[type=radio]').forEach(input => {
    input.addEventListener('change', () => setMode(root, input.value));
  });
  const wipeHandle = root.querySelector('[data-plotcat-wipe-handle]');
  const plotBody = root.querySelector('.plotcat__body');
  let wipeValue = 50;

  function setWipe(value) {
    const percent = Math.round(Math.max(0, Math.min(100, Number(value))));
    wipeValue = percent;
    root.style.setProperty('--plotcat-wipe', `${percent}%`);
    if (wipeHandle) wipeHandle.setAttribute('aria-valuenow', String(percent));
  }

  if (wipeHandle && plotBody) {
    let dragging = false;
    const updateFromPointer = event => {
      const bounds = plotBody.getBoundingClientRect();
      if (bounds.width > 0) setWipe(((event.clientX - bounds.left) / bounds.width) * 100);
    };
    wipeHandle.addEventListener('pointerdown', event => {
      event.preventDefault();
      dragging = true;
      wipeHandle.setPointerCapture(event.pointerId);
      updateFromPointer(event);
    });
    wipeHandle.addEventListener('pointermove', event => {
      if (dragging) updateFromPointer(event);
    });
    wipeHandle.addEventListener('pointerup', event => {
      dragging = false;
      wipeHandle.releasePointerCapture(event.pointerId);
    });
    wipeHandle.addEventListener('pointercancel', () => { dragging = false; });
    wipeHandle.addEventListener('keydown', event => {
      const current = wipeValue;
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? 100
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + 1
        : null;
      if (next !== null) {
        event.preventDefault();
        setWipe(next);
      }
    });
  }

  run.addEventListener('click', async () => {
    if (!targetSvg && !targetFigure) return;
    root.classList.remove('plotcat--error', 'plotcat--complete');
    root.classList.add('plotcat--running');
    run.disabled = true;
    status.textContent = 'Running…';
    try {
      const adapter = await manager.get(manifest.engine);
      const result = await manager.run(manifest.engine, () => adapter.renderSvg(studentCode(root), { width, height }));

      let score;
      if (result.kind === 'plotly') {
        status.textContent = 'Loading Plotly…';
        await loadPlotly();
        await renderPlotly(student, result.figure);
        score = comparePlotly(targetFigure, result.figure, weights.plotly).score;
      } else if (result.kind === 'svg') {
        const svg = sanitizeSvg(result.svg);
        student.replaceChildren(svgFragment(scopeSvgIds(svg, `${svgPrefix}-student`)));
        score = compareSvgFeatures(targetFeatures, extractFeatures(svg), weights.svg).score;
      } else if (result.kind === 'no-plot') {
        throw new Error(result.message);
      } else {
        throw new Error(result.traceback ? `${result.message}\n${result.traceback}` : result.message);
      }

      let hue;
      if (score < 0.5) {
        hue = score * 2 * 35;
      } else if (score < 0.8) {
        hue = 35 + ((score - 0.5) / 0.3) * 25;
      } else {
        hue = 60 + ((score - 0.8) / 0.2) * 60;
      }
      const scoreEl = root.querySelector('.plotcat__score');
      scoreEl.textContent = `${Math.round(score * 100)}%`;
      scoreEl.style.setProperty('--plotcat-score-hue', Math.round(hue));
      status.textContent = '';
      root.classList.add('plotcat--complete');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('requireNamespace') || msg.includes('package is not available') || (msg.includes('not') && msg.includes('module'))) {
        status.textContent = msg + ' Required packages must be listed under `format.live-html` in your Quarto config.';
      } else {
        status.textContent = msg;
      }
      root.classList.add('plotcat--error');
    } finally {
      run.disabled = false;
      root.classList.remove('plotcat--running');
    }
  });
}

document.querySelectorAll('.plotcat[data-plotcat-manifest]').forEach(el => mountPlotCat(el));
