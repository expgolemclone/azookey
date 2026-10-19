import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { createHelpLayout } from '../src/layout.js';

const root = new URL('../../', import.meta.url);
const sources = await Promise.all((await readdir(root))
  .filter((name) => name.endsWith('.json'))
  .toSorted()
  .map(async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'))));
const layouts = sources.flatMap((layout) => [layout, createHelpLayout(layout)]);
const filename = 'azookey-layouts.json';
const json = `${JSON.stringify(layouts, null, 2)}\n`;
const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../dist/', import.meta.url));
await mkdir(output, { recursive: true });
await writeFile(join(output, filename), json);
await writeFile(join(output, 'azookey-layouts.zip'), zipSync({ [filename]: strToU8(json) }));
console.log(`Exported ${layouts.length} layouts as one import JSON and ZIP to ${output}`);
