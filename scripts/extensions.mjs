import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const liveSource = resolve('_extensions/r-wasm/live');

export function copyExtensions(directory) {
  if (!existsSync(liveSource)) {
    throw new Error('Quarto Live is not installed; run `quarto add r-wasm/quarto-live@v0.2.0 --no-prompt`');
  }
  for (const [name, source] of Object.entries({
    plotcat: resolve('_extensions/plotcat'),
    live: liveSource
  })) {
    const destination = resolve(directory, '_extensions', name);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true });
  }
}
