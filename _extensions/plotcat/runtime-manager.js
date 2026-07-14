import { WebRAdapter } from './webr-adapter.js';
import { PyodideAdapter } from './pyodide-adapter.js';

export class RuntimeManager {
  constructor(factories = { r: () => new WebRAdapter(), python: () => new PyodideAdapter() }) { this.factories = factories; this.instances = new Map(); this.queues = new Map(); }
  async get(engine, manifest) {
    if (!this.instances.has(engine)) this.instances.set(engine, (async () => { const adapter = this.factories[engine]?.(); if (!adapter) throw new Error(`Unsupported runtime: ${engine}`); await adapter.init(manifest); return adapter; })());
    return this.instances.get(engine);
  }
  run(engine, task) { const previous = this.queues.get(engine) || Promise.resolve(); const next = previous.catch(() => {}).then(task); this.queues.set(engine, next); return next; }
}
export const runtimeManager = new RuntimeManager();
