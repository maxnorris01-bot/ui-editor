// Bundle the engine for the browser (IIFE, global `UIEngine`) and report raw and gzip sizes.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

mkdirSync('build', { recursive: true });
await build({
  entryPoints: ['engine/src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'UIEngine',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: 'build/engine.js',
  legalComments: 'none',
});
const buf = readFileSync('build/engine.js');
const sizes = { rawBytes: buf.length, gzipBytes: gzipSync(buf, { level: 9 }).length };
writeFileSync('build/engine-size.json', JSON.stringify(sizes, null, 2) + '\n');
console.log(JSON.stringify(sizes));
