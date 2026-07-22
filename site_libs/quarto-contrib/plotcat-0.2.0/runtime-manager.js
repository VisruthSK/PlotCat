import { WebRAdapter } from './webr-adapter.js';
import { PyodideAdapter } from './pyodide-adapter.js';

export class RuntimeManager {
  constructor(factories = { r: () => new WebRAdapter(), python: () => new PyodideAdapter() }) {
    this.factories = factories;
    this.instances = new Map();
    this.queues = new Map();
    this.installedPackages = new Map();
  }

  async get(engine, manifest) {
    if (!this.instances.has(engine)) {
      this.instances.set(engine, (async () => {
        const adapter = this.factories[engine]?.();
        if (!adapter) throw new Error(`Unsupported runtime: ${engine}`);
        await adapter.init({ packages: [] });
        return adapter;
      })());
    }
    const adapter = await this.instances.get(engine);
    if (manifest?.packages?.length) {
      await this.run(engine, async () => {
        const installed = this.installedPackages.get(engine) || new Set();
        const missing = manifest.packages.filter(packageName => !installed.has(packageName));
        if (!missing.length) return;
        await adapter.installPackages(missing);
        missing.forEach(packageName => installed.add(packageName));
        this.installedPackages.set(engine, installed);
      });
    }
    return adapter;
  }

  run(engine, task) {
    const previous = this.queues.get(engine) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(engine, next);
    return next;
  }
}
export const runtimeManager = new RuntimeManager();
