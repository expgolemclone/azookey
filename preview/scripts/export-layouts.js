import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { createHelpLayout } from '../src/layout.js';

const root = new URL('../../', import.meta.url);
const sources = await Promise.all((await readdir(root))
  .filter((name) => name.endsWith('.json'))
  .toSorted()
  .map(async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'))));
const layouts = sources.flatMap((layout) => [layout, createHelpLayout(layout)]);
const files = Object.fromEntries(layouts.map((layout) => [
  `${layout.identifier}.json`, strToU8(`${JSON.stringify(layout, null, 2)}\n`),
]));
const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../dist/azookey-layouts.zip', import.meta.url));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, zipSync(files));
console.log(`Exported ${layouts.length} layouts to ${output}`);
