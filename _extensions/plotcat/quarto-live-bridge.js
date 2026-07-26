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

export const quartoLiveBridge = {
  async getRuntime(engine) {
    const main = await waitForOJS();
    if (engine === 'r') {
      const ojs = await main.value('webROjs');
      return new WebRAdapter(ojs.webRPromise);
    }
    if (engine === 'python') {
      const ojs = await main.value('pyodideOjs');
      return new PyodideAdapter(ojs.pyodidePromise);
    }
    throw new Error(`Unsupported runtime: ${engine}`);
  }
};
