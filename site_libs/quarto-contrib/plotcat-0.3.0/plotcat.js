import { compareSvgFeatures, comparePlotly, prepareSvg } from './svg.js';
import { withRetry, errorMessage } from './utils.js';
import { runtimeManager } from './runtime-manager.js';

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

function packageHint(msg) {
  if (msg.includes('requireNamespace') || msg.includes('package is not available') || (msg.includes('not') && msg.includes('module'))) {
    return msg + ' Required packages must be listed under `format.live-html` in your Quarto config.';
  }
  return msg;
}

function limitPlotlyToSideBySide(root) {
  const radios = root.querySelectorAll('input[value="overlay"], input[value="wipe"]');
  root.querySelector('input[value="side-by-side"]').checked = true;
  radios.forEach(input => {
    input.disabled = true;
    input.closest('label').title = 'Overlay and wipe are unavailable for Plotly charts.';
  });
  setMode(root, 'side-by-side');
  return radios;
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

async function renderPlotly(target, figure) {
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

  const layout = structuredClone(figure.layout || {});
  delete layout.width;
  delete layout.height;
  layout.autosize = true;
  layout.margin = {
    l: 40,
    r: 10,
    t: 30,
    b: 40,
    ...layout.margin
  };

  const config = { ...(figure.config || {}), responsive: true, displayModeBar: false };
  await Plotly.newPlot(div, figure.data || [], layout, config);
  if (Array.isArray(figure.frames) && figure.frames.length > 0) {
    await Plotly.addFrames(div, figure.frames);
  }
  return div;
}

export function mountPlotCat(root, manager) {
  const mgr = (manager && typeof manager.get === 'function') ? manager : runtimeManager;
  const manifest = JSON.parse(root.dataset.plotcatManifest);
  const adapterPromise = mgr.get(manifest.engine);
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
    const result = await mgr.run(manifest.engine, () => adapter.renderSvg(targetCode, { width, height }));

    if (result.kind === 'plotly') {
      outputType = 'plotly';
      targetFigure = result.figure;
      status.textContent = 'Loading Plotly…';
      await loadPlotly();
      limitPlotlyToSideBySide(root);
      await renderPlotly(target, targetFigure);
    } else if (result.kind === 'svg') {
      outputType = 'svg';
      const result_ = prepareSvg(result.svg, `${svgPrefix}-target`);
      targetSvg = result_.svg;
      targetFeatures = result_.features;
      target.replaceChildren(svgFragment(result_.svg));
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
        status.textContent = 'Error rendering target: ' + packageHint(errorMessage(error));
        root.classList.add('plotcat--error');
      });
  } else {
    const targetSvgEl = target.querySelector('svg');
    if (targetSvgEl) {
      outputType = 'svg';
      const result_ = prepareSvg(targetSvgEl.outerHTML, `${svgPrefix}-target`);
      targetSvg = result_.svg;
      targetFeatures = result_.features;
      target.replaceChildren(svgFragment(result_.svg));
      status.textContent = '';
      run.disabled = false;
    }
  }

  const radios = root.querySelectorAll('input[type=radio]');
  radios.forEach(input => {
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
      const adapter = await mgr.get(manifest.engine);
      const result = await mgr.run(manifest.engine, () => adapter.renderSvg(studentCode(root), { width, height }));

      let score;
      if (result.kind === 'plotly') {
        status.textContent = 'Loading Plotly…';
        await loadPlotly();
        await renderPlotly(student, result.figure);
        score = comparePlotly(targetFigure, result.figure).score / 100;
      } else if (result.kind === 'svg') {
        const result_ = prepareSvg(result.svg, `${svgPrefix}-student`);
        student.replaceChildren(svgFragment(result_.svg));
        score = compareSvgFeatures(targetFeatures, result_.features, weights.svg).score;
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
      status.textContent = packageHint(errorMessage(error));
      root.classList.add('plotcat--error');
    } finally {
      run.disabled = false;
      root.classList.remove('plotcat--running');
    }
  });
}

document.querySelectorAll('.plotcat[data-plotcat-manifest]').forEach(el => mountPlotCat(el));
