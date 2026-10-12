import { r } from './runtime-r.js';
import { python } from './runtime-python.js';

const ENGINES = { r, python };

function waitForOjs(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const main = window._ojs?.ojsConnector?.mainModule;
      if (main) {
        resolve(main);
      } else if (performance.now() - started >= timeoutMs) {
        reject(new Error('Quarto Live did not initialize its OJS runtime.'));
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

async function bootRuntime(engine) {
  const config = ENGINES[engine];
  const main = await waitForOjs();
  const ojs = await main.value(config.ojsKey);
  const runtime = await ojs[config.promiseKey];
  await config.setup(runtime);
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
