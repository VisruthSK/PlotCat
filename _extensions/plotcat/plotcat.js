import { compareSvg, sanitizeSvg } from './svg.js';
import { runtimeManager } from './runtime-manager.js';

function setMode(root, mode) {
  root.classList.remove('plotcat--side-by-side', 'plotcat--overlay', 'plotcat--wipe');
  root.classList.add(`plotcat--${mode}`);
}

function svgFragment(svg) {
  return document.createRange().createContextualFragment(svg);
}

export function mountPlotCat(root, manager = runtimeManager) {
  if (!manager || typeof manager.get !== 'function') {
    manager = runtimeManager;
  }
  const manifest = JSON.parse(root.dataset.plotcatManifest);
  const adapterPromise = manager.get(manifest.engine, manifest);
  // Prevent unhandled promise rejection warnings in the console
  adapterPromise.catch(() => {});

  const run = root.querySelector('[data-plotcat-run]');
  const status = root.querySelector('.plotcat__status');
  const target = root.querySelector('[data-plotcat-target]');
  const student = root.querySelector('[data-plotcat-student]');
  const targetSvgEl = target.querySelector('svg');
  const targetSvg = sanitizeSvg(targetSvgEl.outerHTML);
  target.replaceChildren(svgFragment(targetSvg));

  let width = 7;
  let height = 7;
  if (targetSvgEl) {
    const viewBox = targetSvgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/\s+/).map(Number);
      if (parts.length === 4) {
        const w = parts[2] - parts[0];
        const h = parts[3] - parts[1];
        if (w > 0 && h > 0) {
          width = w / 72;
          height = h / 72;
        }
      }
    } else {
      const w = parseFloat(targetSvgEl.getAttribute('width'));
      const h = parseFloat(targetSvgEl.getAttribute('height'));
      if (w > 0 && h > 0) {
        width = w / 72;
        height = h / 72;
      }
    }
  }

  root.querySelectorAll('input[type=radio]').forEach(input => {
    input.addEventListener('change', () => setMode(root, input.value));
  });
  root.querySelector('[data-plotcat-wipe]').addEventListener('input', event => {
    root.style.setProperty('--plotcat-wipe', `${event.target.value}%`);
  });

  run.addEventListener('click', async () => {
    root.classList.remove('plotcat--error', 'plotcat--complete');
    root.classList.add('plotcat--running');
    run.disabled = true;
    status.textContent = `Loading ${manifest.engine === 'r' ? 'WebR' : 'Pyodide'}…`;
    try {
      const adapter = await adapterPromise;
      status.textContent = 'Running…';
      const svg = sanitizeSvg(await manager.run(manifest.engine, () => adapter.renderSvg(root.querySelector('textarea').value, { width, height })));
      student.replaceChildren(svgFragment(svg));
      const result = compareSvg(targetSvg, svg);
      root.querySelector('.plotcat__score').textContent = `${Math.round(result.score * 100)}%`;
      root.querySelector('.plotcat__feedback').textContent = result.feedback.join(' ');
      status.textContent = 'Plot rendered.';
      root.classList.add('plotcat--complete');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      root.classList.add('plotcat--error');
    } finally {
      run.disabled = false;
      root.classList.remove('plotcat--running');
    }
  });
}

document.querySelectorAll('.plotcat[data-plotcat-manifest]').forEach(el => mountPlotCat(el));
