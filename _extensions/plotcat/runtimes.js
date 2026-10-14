import { r } from './runtime-r.js';
import { python } from './runtime-python.js';

const ENGINES = { r, python };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const runtimeSources = { r: deferred(), python: deferred() };
const provided = { r: false, python: false };

export const bridge = {
  provide(engine, runtimePromise) {
    provided[engine] = true;
    runtimeSources[engine].resolve(runtimePromise);
  }
};

export const isRuntimeProvided = engine => provided[engine];

async function bootRuntime(engine) {
  const runtime = await runtimeSources[engine].promise;
  await ENGINES[engine].setup(runtime);
  return runtime;
}

const runtimes = {};
const queues = {};

function startRuntime(engine) {
  runtimes[engine] ??= bootRuntime(engine);
  return runtimes[engine];
}

export function enqueue(engine, task) {
  const next = (queues[engine] ?? Promise.resolve()).catch(() => {}).then(task);
  queues[engine] = next;
  return next;
}

export function renderOn(engine, runtime, code, size) {
  const call = `plotcat_render(${JSON.stringify(code)}, ${size.width}, ${size.height})`;
  return ENGINES[engine].evaluate(runtime, call).then(text => parseOutput(engine, text));
}

function parseOutput(engine, text) {
  if (!text.startsWith('{')) return { kind: 'svg', svg: text };
  const parsed = JSON.parse(text);
  if (parsed.type === 'plotly') return { kind: 'plotly', figure: parsed.data };
  if (parsed.type === 'no-plot') {
    return {
      kind: 'no-plot',
      message: `Code did not produce a plot. Make sure the last expression generates a plot (e.g., ${ENGINES[engine].example}).`,
      output: parsed.output
    };
  }
  return { kind: 'error', message: parsed.message, output: parsed.output };
}

export function renderPlot(engine, code, size) {
  return enqueue(engine, async () => renderOn(engine, await startRuntime(engine), code, size));
}

export { ENGINES };
