import { compareSvgFeatures, extractFeatures, sanitizeSvg, scopeSvgIds, comparePlotly } from './svg.js';
import { runtimeManager } from './runtime-manager.js';

let plotlyPromise;

function loadPlotly() {
  if (window.Plotly) {
    return Promise.resolve(window.Plotly);
  }

  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.plot.ly/plotly-2.35.2.min.js';
      script.onload = () => resolve(window.Plotly);
      script.onerror = () => {
        plotlyPromise = undefined;
        reject(new Error('Failed to load Plotly.'));
      };
      document.head.appendChild(script);
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

export function mountPlotCat(root, manager = runtimeManager) {
  if (!manager || typeof manager.get !== 'function') {
    manager = runtimeManager;
  }
  const manifest = JSON.parse(root.dataset.plotcatManifest);
  const adapterPromise = manager.get(manifest.engine);
  // Prevent unhandled promise rejection warnings in the console
  adapterPromise.catch(() => {});

  const run = root.querySelector('[data-plotcat-run]');
  const status = root.querySelector('.plotcat__status');
  const feedbackEl = root.querySelector('.plotcat__feedback');
  const target = root.querySelector('[data-plotcat-target]');
  const student = root.querySelector('[data-plotcat-student]');

  const targetCodeBase64 = root.dataset.plotcatTargetCode;
  const svgPrefix = (root.id || manifest.id || 'plotcat').replace(/[^a-zA-Z0-9_-]/g, '-');

  let width = manifest.engine === 'r' ? 7 : 6.4;
  let height = manifest.engine === 'r' ? 5 : 4.8;

  let targetSvg = null;
  let targetFeatures = null;
  let targetPlotlyPayload = null;

  if (targetCodeBase64) {
    run.disabled = true;
    status.textContent = `Loading ${manifest.engine === 'r' ? 'WebR' : 'Pyodide'}…`;
    (async () => {
      const targetCode = decodeTarget(targetCodeBase64);
      const adapter = await adapterPromise;

      status.textContent = 'Rendering target…';
      const result = await manager.run(manifest.engine, () => adapter.renderSvg(targetCode, { width, height }));

      if (result.startsWith('{"type":"plotly"')) {
        status.textContent = 'Loading Plotly…';
        await loadPlotly();
        const payload = JSON.parse(result);
        targetPlotlyPayload = payload.data.x ? payload.data.x : payload.data;
        limitPlotlyToSideBySide(root);
        const previousTarget = target.querySelector('.js-plotly-plot');
        if (previousTarget && window.Plotly) {
          window.Plotly.purge(previousTarget);
        }
        target.replaceChildren();
        target.style.height = '280px';
        const plotlyDiv = document.createElement('div');
        plotlyDiv.style.width = '100%';
        plotlyDiv.style.height = '100%';
        plotlyDiv.style.alignSelf = 'stretch';
        plotlyDiv.style.flexGrow = '1';
        target.appendChild(plotlyDiv);
        await Plotly.newPlot(plotlyDiv, targetPlotlyPayload.data, targetPlotlyPayload.layout, { responsive: true, displayModeBar: false });
      } else {
        targetSvg = sanitizeSvg(result);
        targetFeatures = extractFeatures(targetSvg);
        target.replaceChildren(svgFragment(scopeSvgIds(targetSvg, `${svgPrefix}-target`)));
      }

      status.textContent = '';
      run.disabled = false;
    })().catch(error => {
      console.error('Failed to render target plot:', error);
      status.textContent = 'Error rendering target: ' + (error.message || error);
      root.classList.add('plotcat--error');
    });
  } else {
    const targetSvgEl = target.querySelector('svg');
    if (targetSvgEl) {
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
    if (!targetSvg && !targetPlotlyPayload) return;
    root.classList.remove('plotcat--error', 'plotcat--complete');
    feedbackEl.textContent = '';
    root.classList.add('plotcat--running');
    run.disabled = true;
    status.textContent = 'Running…';
    try {
      const adapter = await manager.get(manifest.engine);
      const result = await manager.run(manifest.engine, () => adapter.renderSvg(studentCode(root), { width, height }));

      let score, feedback;
      if (result.startsWith('{"type":"plotly"')) {
        status.textContent = 'Loading Plotly…';
        await loadPlotly();
        const payload = JSON.parse(result);
        const studentPlotlyPayload = payload.data.x ? payload.data.x : payload.data;
        const previous = student.querySelector('.js-plotly-plot');
        if (previous && window.Plotly) {
          window.Plotly.purge(previous);
        }
        student.replaceChildren();
        student.style.height = '280px';
        const plotlyDiv = document.createElement('div');
        plotlyDiv.style.width = '100%';
        plotlyDiv.style.height = '100%';
        plotlyDiv.style.alignSelf = 'stretch';
        plotlyDiv.style.flexGrow = '1';
        student.appendChild(plotlyDiv);
        await Plotly.newPlot(plotlyDiv, studentPlotlyPayload.data, studentPlotlyPayload.layout, { responsive: true, displayModeBar: false });

        const compareResult = comparePlotly(targetPlotlyPayload, studentPlotlyPayload);
        score = compareResult.score;
        feedback = compareResult.feedback;
      } else {
        // Purge any previous Plotly chart
        const previousPlotly = student.querySelector('.js-plotly-plot');
        if (previousPlotly && window.Plotly) {
          window.Plotly.purge(previousPlotly);
        }
        // Remove inline height set by Plotly branch
        student.style.removeProperty('height');
        const svg = sanitizeSvg(result);
        student.replaceChildren(svgFragment(scopeSvgIds(svg, `${svgPrefix}-student`)));
        const studentFeatures = extractFeatures(svg);
        const compareResult = compareSvgFeatures(targetFeatures, studentFeatures);
        score = compareResult.score;
        feedback = compareResult.feedback || [];
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
      feedbackEl.textContent = feedback.join(' ');
      status.textContent = '';
      root.classList.add('plotcat--complete');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      feedbackEl.textContent = error?.output || '';
      root.classList.add('plotcat--error');
    } finally {
      run.disabled = false;
      root.classList.remove('plotcat--running');
    }
  });
}

document.querySelectorAll('.plotcat[data-plotcat-manifest]').forEach(el => mountPlotCat(el));

