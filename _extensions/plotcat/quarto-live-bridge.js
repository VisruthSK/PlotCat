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

const ENGINE_CONFIG = {
  r: { ojsKey: 'webROjs', promiseKey: 'webRPromise', Adapter: WebRAdapter },
  python: { ojsKey: 'pyodideOjs', promiseKey: 'pyodidePromise', Adapter: PyodideAdapter }
};

async function getRuntimePromise(config) {
  const main = await waitForOJS();
  const ojs = await main.value(config.ojsKey);
  return ojs[config.promiseKey];
}

export const quartoLiveBridge = {
  getRuntime(engine) {
    const config = ENGINE_CONFIG[engine];
    if (!config) throw new Error(`Unsupported runtime: ${engine}`);
    return new config.Adapter(getRuntimePromise(config));
  }
};
