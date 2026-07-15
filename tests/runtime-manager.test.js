import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeManager } from '../_extensions/plotcat/runtime-manager.js';

test('runtimes are lazy and reused', async () => {
  let made = 0, initialized = 0;
  const manager = new RuntimeManager({ r: () => { made++; return { init: async () => initialized++ }; } });
  assert.equal(made, 0);
  const first = await manager.get('r', {}); const second = await manager.get('r', {});
  assert.equal(first, second); assert.equal(made, 1); assert.equal(initialized, 1);
});

test('package installation uses the engine queue before the caller renders', async () => {
  const order = [];
  const adapter = {
    init: async manifest => order.push(`init:${manifest.packages.length}`),
    installPackages: async packages => order.push(`install:${packages.join(',')}`)
  };
  const manager = new RuntimeManager({ python: () => adapter });
  const loaded = await manager.get('python', { packages: ['plotnine'] });
  assert.equal(loaded, adapter);
  await manager.run('python', async () => order.push('render'));
  assert.deepEqual(order, ['init:0', 'install:plotnine', 'render']);
});

test('runs for one engine are queued after failures', async () => {
  const manager = new RuntimeManager({}); const order = [];
  const one = manager.run('r', async () => { order.push('one'); throw new Error('bad code'); });
  const two = manager.run('r', async () => order.push('two'));
  await assert.rejects(one, /bad code/); await two;
  assert.deepEqual(order, ['one', 'two']);
});

test('different language queues can run independently', async () => {
  const manager = new RuntimeManager({}); const order = [];
  let releaseR; const rGate = new Promise(resolve => { releaseR = resolve; });
  const r = manager.run('r', async () => { order.push('r-start'); await rGate; order.push('r-end'); });
  const python = manager.run('python', async () => { order.push('python'); });
  await python; assert.deepEqual(order, ['r-start', 'python']);
  releaseR(); await r; assert.deepEqual(order, ['r-start', 'python', 'r-end']);
});

test('unsupported engines fail before creating a runtime', async () => {
  const manager = new RuntimeManager({});
  await assert.rejects(manager.get('julia', {}), /Unsupported runtime: julia/);
});
