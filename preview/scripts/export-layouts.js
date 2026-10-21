import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHelpLayout } from '../src/layout.js';

const root = new URL('../../', import.meta.url);
const sources = await Promise.all((await readdir(root))
  .filter((name) => name.endsWith('.json') && name !== 'azookey-layouts.json')
  .toSorted()
  .map(async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'))));
const layouts = sources.flatMap((layout) => [layout, createHelpLayout(layout)]);
const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../dist/', import.meta.url));
await mkdir(output, { recursive: true });
await writeFile(join(output, 'azookey-layouts.json'), `${JSON.stringify(layouts, null, 2)}\n`);
console.log(`Exported ${layouts.length} layouts as one import JSON to ${output}`);
