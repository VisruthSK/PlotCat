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
  const manifest = JSON.parse(root.dataset.plotcatManifest);
  const run = root.querySelector('[data-plotcat-run]');
  const status = root.querySelector('.plotcat__status');
  const target = root.querySelector('[data-plotcat-target]');
  const student = root.querySelector('[data-plotcat-student]');
  const targetSvg = sanitizeSvg(target.querySelector('svg').outerHTML);
  target.replaceChildren(svgFragment(targetSvg));

  root.querySelectorAll('input[type=radio]').forEach(input => {
    input.addEventListener('change', () => setMode(root, input.value));
  });
  root.querySelector('[data-plotcat-wipe]').addEventListener('input', event => {
    root.style.setProperty('--plotcat-wipe', `${event.target.value}%`);
  });
  root.querySelector('[data-plotcat-toggle]').addEventListener('click', event => {
    const hidden = student.hidden = !student.hidden;
    event.currentTarget.textContent = hidden ? 'Show student' : 'Hide student';
  });

  run.addEventListener('click', async () => {
    root.classList.remove('plotcat--error', 'plotcat--complete');
    root.classList.add('plotcat--running');
    run.disabled = true;
    status.textContent = `Loading ${manifest.engine === 'r' ? 'WebR' : 'Pyodide'}…`;
    try {
      const adapter = await manager.get(manifest.engine, manifest);
      status.textContent = 'Running…';
      const svg = sanitizeSvg(await manager.run(manifest.engine, () => adapter.renderSvg(root.querySelector('textarea').value, {})));
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

document.querySelectorAll('.plotcat[data-plotcat-manifest]').forEach(mountPlotCat);
