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

test('runs for one engine are queued after failures', async () => {
  const manager = new RuntimeManager({}); const order = [];
  const one = manager.run('r', async () => { order.push('one'); throw new Error('bad code'); });
  const two = manager.run('r', async () => order.push('two'));
  await assert.rejects(one, /bad code/); await two;
  assert.deepEqual(order, ['one', 'two']);
});
