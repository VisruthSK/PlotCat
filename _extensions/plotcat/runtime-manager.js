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
