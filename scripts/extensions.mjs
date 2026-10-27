import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export function copyExtensions(directory) {
  for (const [name, source] of Object.entries({
    plotcat: '_extensions/plotcat',
    live: 'vendor/quarto-live/_extensions/live'
  })) {
    const destination = resolve(directory, '_extensions', name);
    rmSync(destination, { recursive: true, force: true });
    cpSync(resolve(source), destination, { recursive: true });
  }
}
