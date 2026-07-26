import { withRetry } from './utils.js';
import { quartoLiveBridge } from './quarto-live-bridge.js';

export class RuntimeManager {
  constructor(factories = {
    r: () => quartoLiveBridge.getRuntime('r'),
    python: () => quartoLiveBridge.getRuntime('python')
  }) {
    this.factories = factories;
    this.instances = new Map();
    this.queues = new Map();
  }

  async get(engine) {
    if (!this.instances.has(engine)) {
      const factory = this.factories[engine];
      if (!factory) {
        const err = Promise.reject(new Error(
          `Unsupported runtime: ${engine}. Use 'r' for WebR or 'python' for Pyodide.`
        ));
        err.catch(() => {});
        this.instances.set(engine, err);
        return err;
      }

      const promise = withRetry(async () => {
        const adapter = factory();
        if (!adapter) throw new Error(`Runtime factory for '${engine}' returned null`);
        await adapter.init();
        return adapter;
      }).catch(() => {
        const name = engine === 'r' ? 'WebR' : engine === 'python' ? 'Pyodide' : engine;
        throw new Error(
          `Could not load ${name} after 3 attempts. ` +
          `Check your internet connection. The runtime downloads from ` +
          `${engine === 'r' ? 'webr.r-wasm.org' : 'cdn.jsdelivr.net/pyodide'} ` +
          `on first use and is cached by your browser afterwards. ` +
          `If you use a corporate proxy or firewall, confirm these domains are allowed.`
        );
      });
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
