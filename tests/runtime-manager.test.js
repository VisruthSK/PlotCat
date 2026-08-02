import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeManager } from '../_extensions/plotcat/runtime-manager.js';

test('runtimes are lazy and reused', async () => {
  let made = 0, initialized = 0;
  const manager = new RuntimeManager({ r: () => { made++; return { init: async () => initialized++ }; } });
  assert.equal(made, 0);
  const first = await manager.get('r'); const second = await manager.get('r');
  assert.equal(first, second); assert.equal(made, 1); assert.equal(initialized, 1);
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

test('unsupported engines fail immediately without retry', async () => {
  const manager = new RuntimeManager({});
  await assert.rejects(manager.get('julia'), /Use .r. for WebR or .python. for Pyodide/);
});

test('runtime init is retried up to 3 times before giving up', async () => {
  let attempts = 0;
  const manager = new RuntimeManager({
    r: () => ({
      init: async () => {
        attempts++;
        throw new Error('CDN download failed');
      }
    })
  });
  await assert.rejects(manager.get('r'), /after 3 attempts/);
  assert.equal(attempts, 3);
});

test('runtime init succeeds on retry if transient failure clears', async () => {
  let attempts = 0;
  const manager = new RuntimeManager({
    r: () => ({
      init: async () => {
        attempts++;
        if (attempts < 3) throw new Error('Transient failure');
      }
    })
  });
  const adapter = await manager.get('r');
  assert.ok(adapter);
  assert.equal(attempts, 3);
});

test('runtime initialization is delegated to Quarto Live', async () => {
  let initCalls = 0;

  const adapter = {
    init: async () => {
      initCalls += 1;
    }
  };

  const manager = new RuntimeManager({
    python: () => adapter
  });

  assert.equal(await manager.get('python'), adapter);
  assert.equal(await manager.get('python'), adapter);
  assert.equal(initCalls, 1);
});
