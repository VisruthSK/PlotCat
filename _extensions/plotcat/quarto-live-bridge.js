import { WebRAdapter } from './webr-adapter.js';
import { PyodideAdapter } from './pyodide-adapter.js';

function waitForOJS(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();

    function check() {
      const main = window._ojs?.ojsConnector?.mainModule;
      if (main) {
        resolve(main);
        return;
      }

      if (performance.now() - started >= timeoutMs) {
        reject(
          new Error(
            'Quarto Live did not initialize its OJS runtime. ' +
            'Ensure Quarto Live is installed and use ' +
            '`format: live-html`.'
          )
        );
        return;
      }

      requestAnimationFrame(check);
    }

    check();
  });
}

async function getWebR() {
  const main = await waitForOJS();
  const ojs = await main.value('webROjs');
  return ojs.webRPromise;
}

async function getPyodide() {
  const main = await waitForOJS();
  const ojs = await main.value('pyodideOjs');
  return ojs.pyodidePromise;
}

export const quartoLiveBridge = {
  getRuntime(engine) {
    if (engine === 'r') {
      return new WebRAdapter(getWebR());
    }
    if (engine === 'python') {
      return new PyodideAdapter(getPyodide());
    }
    throw new Error(`Unsupported runtime: ${engine}`);
  }
};
