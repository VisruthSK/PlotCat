import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const liveSource = resolve('node_modules/quarto-live/_extensions/live');

export function copyExtensions(directory) {
  if (!existsSync(liveSource)) {
    throw new Error('Quarto Live is not installed; run `pnpm install`');
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
