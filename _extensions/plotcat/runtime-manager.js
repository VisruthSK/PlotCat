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

export class RuntimeManager {
  constructor(factories = {
    r: () => {
      const promise = waitForOJS()
        .then(main => main.value('webROjs'))
        .then(ojs => ojs.webRPromise);
      return new WebRAdapter(promise);
    },
    python: () => {
      const promise = waitForOJS()
        .then(main => main.value('pyodideOjs'))
        .then(ojs => ojs.pyodidePromise);
      return new PyodideAdapter(promise);
    }
  }) {
    this.factories = factories;
    this.instances = new Map();
    this.queues = new Map();
  }

  async get(engine) {
    if (!this.instances.has(engine)) {
      const promise = (async () => {
        const adapter = this.factories[engine]?.();

        if (!adapter) {
          throw new Error(`Unsupported runtime: ${engine}`);
        }

        await adapter.init();
        return adapter;
      })();

      this.instances.set(engine, promise);

      promise.catch(() => {
        if (this.instances.get(engine) === promise) {
          this.instances.delete(engine);
        }
      });
    }

    return this.instances.get(engine);
  }

  run(engine, task) {
    const previous = this.queues.get(engine) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(engine, next);
    return next;
  }
}
export const runtimeManager = new RuntimeManager();
