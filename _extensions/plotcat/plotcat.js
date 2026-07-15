import { compareSvg, sanitizeSvg, scopeSvgIds } from './svg.js';
import { runtimeManager } from './runtime-manager.js';

async function decodePattern(salt, encoded) {
  const bytes = new TextEncoder().encode(salt);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const key = new Uint8Array(hash);
  const resultBytes = new Uint8Array(encoded.length / 2);
  for (let i = 0; i < resultBytes.length; i++) {
    resultBytes[i] = parseInt(encoded.slice(i * 2, i * 2 + 2), 16) ^ key[i % key.length];
  }
  return new TextDecoder().decode(resultBytes);
}

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

  const targetCodeHex = root.dataset.plotcatTargetCode;
  const salt = root.dataset.plotcatSalt;
  const svgPrefix = (root.id || manifest.id || 'plotcat').replace(/[^a-zA-Z0-9_-]/g, '-');

  let width = manifest.engine === 'r' ? 7 : 6.4;
  let height = manifest.engine === 'r' ? 5 : 4.8;

  let targetSvg = null;

  if (targetCodeHex && salt) {
    run.disabled = true;
    status.textContent = `Loading ${manifest.engine === 'r' ? 'WebR' : 'Pyodide'}…`;
    decodePattern(salt, targetCodeHex).then(async (targetCode) => {
      const adapter = await adapterPromise;
      const svg = sanitizeSvg(await manager.run(manifest.engine, () => adapter.renderSvg(targetCode, { width, height })));
      targetSvg = svg;
      target.replaceChildren(svgFragment(scopeSvgIds(targetSvg, `${svgPrefix}-target`)));
      status.textContent = 'Ready.';
      run.disabled = false;
    }).catch(error => {
      console.error('Failed to render target plot:', error);
      status.textContent = 'Error rendering target: ' + (error.message || error);
      root.classList.add('plotcat--error');
    });
  } else {
    const targetSvgEl = target.querySelector('svg');
    if (targetSvgEl) {
      targetSvg = sanitizeSvg(targetSvgEl.outerHTML);
      target.replaceChildren(svgFragment(scopeSvgIds(targetSvg, `${svgPrefix}-target`)));
      status.textContent = 'Ready.';
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

  const overlay = root.querySelector('.plotcat-highlight-overlay');
  const textarea = root.querySelector('.plotcat__textarea');

  function updateHighlight() {
    if (overlay && textarea) {
      overlay.innerHTML = highlightCode(textarea.value, manifest.engine) + '\n';
    }
  }

  if (textarea && overlay) {
    textarea.addEventListener('input', updateHighlight);
    textarea.addEventListener('scroll', () => {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    });
    textarea.addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        event.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 4;
        updateHighlight();
      }
    });
    updateHighlight();
  }

  run.addEventListener('click', async () => {
    if (!targetSvg) return;
    root.classList.remove('plotcat--error', 'plotcat--complete');
    root.classList.add('plotcat--running');
    run.disabled = true;
    status.textContent = 'Running…';
    try {
      const adapter = await manager.get(manifest.engine, manifest);
      const svg = sanitizeSvg(await manager.run(manifest.engine, () => adapter.renderSvg(root.querySelector('textarea').value, { width, height })));
      student.replaceChildren(svgFragment(scopeSvgIds(svg, `${svgPrefix}-student`)));
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

function highlightCode(code, engine) {
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const rKeywords = /\b(library|function|if|else|for|in|while|repeat|next|break|TRUE|FALSE|NULL)\b/g;
  const pyKeywords = /\b(import|from|def|class|return|if|else|elif|for|in|while|try|except|as|lambda|True|False|None)\b/g;

  const tokens = [];
  const tokenRegex = /(".*?"|'.*?'|#.*|[^\s"'\#]+|\s+)/g;
  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    let part = match[0];
    if (part.startsWith('#')) {
      tokens.push(`<span class="plotcat-hl-comment">${part}</span>`);
    } else if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      tokens.push(`<span class="plotcat-hl-string">${part}</span>`);
    } else {
      const kw = engine === 'r' ? rKeywords : pyKeywords;
      part = part.replace(kw, '<span class="plotcat-hl-keyword">$1</span>');
      part = part.replace(/(\b\d+(?:\.\d+)?\b)/g, '<span class="plotcat-hl-number">$1</span>');
      part = part.replace(/(\b[a-zA-Z_][a-zA-Z0-9_]*)(?=\()/g, '<span class="plotcat-hl-function">$1</span>');
      tokens.push(part);
    }
  }
  return tokens.join('');
}

document.querySelectorAll('.plotcat[data-plotcat-manifest]').forEach(el => mountPlotCat(el));
