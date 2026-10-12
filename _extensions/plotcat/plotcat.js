import { compareSvgFeatures, displaySvg } from './svg.js';
import { comparePlotly } from './plotly-compare.js';
import { loadPlotly, renderPlotly } from './plotly.js';
import { renderPlot, ENGINES } from './runtimes.js';

const outputs = {
  svg: {
    show: (container, result, prefix) => displaySvg(container, result.svg, prefix),
    score: (target, student, weights) => compareSvgFeatures(target, student, weights.svg)
  },
  plotly: {
    show: async (container, result) => {
      await loadPlotly();
      await renderPlotly(container, result.figure);
      return result.figure;
    },
    score: (target, student, weights) => comparePlotly(target, student, weights.plotly).score / 100
  }
};

function whenVisible(element) {
  if (!('IntersectionObserver' in window)) return Promise.resolve();
  return new Promise(resolve => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        resolve();
      }
    }, { rootMargin: '400px' });
    observer.observe(element);
  });
}

function decodeTarget(encoded) {
  const binary = atob(encoded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function resultError(result) {
  return new Error([result.message, result.output].filter(Boolean).join('\n'));
}

function setMode(root, mode) {
  root.classList.remove('plotcat--side-by-side', 'plotcat--overlay', 'plotcat--wipe');
  root.classList.add(`plotcat--${mode}`);
}

function packageHint(message) {
  if (message.includes('requireNamespace') || message.includes('package is not available') || (message.includes('not') && message.includes('module'))) {
    return message + ' Required packages must be listed under `format.live-html` in your Quarto config.';
  }
  return message;
}

function limitToSideBySide(root) {
  const radios = root.querySelectorAll('input[value="overlay"], input[value="wipe"]');
  root.querySelector('input[value="side-by-side"]').checked = true;
  radios.forEach(input => {
    input.disabled = true;
    input.closest('label').title = 'Overlay and wipe are unavailable for Plotly charts.';
  });
  setMode(root, 'side-by-side');
}

function studentCode(root) {
  const editor = root.querySelector('.plotcat__editor .cm-content');
  if (!editor) {
    throw new Error(
      "PlotCat could not find Quarto Live's code editor. " +
      "Ensure Quarto Live is installed and use `format: live-html`."
    );
  }
  return editor.innerText;
}

function scoreHue(score) {
  if (score < 0.5) return score * 2 * 35;
  if (score < 0.8) return 35 + ((score - 0.5) / 0.3) * 25;
  return 60 + ((score - 0.8) / 0.2) * 60;
}

export function mountPlotCat(root) {
  const manifest = JSON.parse(root.dataset.plotcatManifest);
  const weights = JSON.parse(atob(root.dataset.plotcatWeights));
  const run = root.querySelector('[data-plotcat-run]');
  const status = root.querySelector('.plotcat__status');
  const target = root.querySelector('[data-plotcat-target]');
  const student = root.querySelector('[data-plotcat-student]');
  const size = { width: manifest.width || 7, height: manifest.height || 5 };
  const prefix = (root.id || manifest.id || 'plotcat').replace(/[^a-zA-Z0-9_-]/g, '-');
  const label = ENGINES[manifest.engine].label;

  let targetKind = null;
  let targetCaptured = null;

  const visible = whenVisible(root);
  if (manifest.plotly) visible.then(() => loadPlotly().catch(() => {}));

  async function renderTarget() {
    const targetCode = decodeTarget(root.dataset.plotcatTargetCode);
    await visible;
    status.textContent = `Loading ${label}…`;
    const result = await renderPlot(manifest.engine, targetCode, size);
    const output = outputs[result.kind];
    if (!output) throw resultError(result);
    if (result.kind === 'plotly') {
      status.textContent = 'Loading Plotly…';
      limitToSideBySide(root);
    }
    targetCaptured = await output.show(target, result, `${prefix}-target`);
    targetKind = result.kind;
  }

  if (root.dataset.plotcatTargetCode) {
    run.disabled = true;
    renderTarget()
      .then(() => { status.textContent = ''; run.disabled = false; })
      .catch(error => {
        console.error('Failed to render target plot:', error);
        status.textContent = 'Error rendering target: ' + packageHint(errorMessage(error));
        root.classList.add('plotcat--error');
        run.disabled = false;
      });
  } else {
    const staticSvg = target.querySelector('svg');
    if (staticSvg) {
      targetKind = 'svg';
      targetCaptured = displaySvg(target, staticSvg.outerHTML, `${prefix}-target`);
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
    wipeHandle.setAttribute('aria-valuenow', String(percent));
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
      const steps = { Home: 0, End: 100, ArrowLeft: wipeValue - 1, ArrowDown: wipeValue - 1, ArrowRight: wipeValue + 1, ArrowUp: wipeValue + 1 };
      if (event.key in steps) {
        event.preventDefault();
        setWipe(steps[event.key]);
      }
    });
  }

  run.addEventListener('click', async () => {
    if (!targetKind) return;
    root.classList.remove('plotcat--error', 'plotcat--complete');
    root.classList.add('plotcat--running');
    run.disabled = true;
    status.textContent = 'Running…';
    try {
      const result = await renderPlot(manifest.engine, studentCode(root), size);
      const output = outputs[result.kind];
      if (!output) throw resultError(result);
      if (result.kind !== targetKind) throw new Error('Student output must use the same plot type as the target.');
      const studentCaptured = await output.show(student, result, `${prefix}-student`);
      const score = output.score(targetCaptured, studentCaptured, weights);

      const scoreEl = root.querySelector('.plotcat__score');
      scoreEl.textContent = `${Math.round(score * 100)}%`;
      scoreEl.style.setProperty('--plotcat-score-hue', Math.round(scoreHue(score)));
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

document.querySelectorAll('.plotcat[data-plotcat-manifest]').forEach(mountPlotCat);
