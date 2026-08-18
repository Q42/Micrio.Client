/**
 * Builds `grid.ts` → `grid.js` (in this same directory) as a single,
 * self-contained classic script (IIFE) for static releases.
 *
 * The TypeScript `import type` statements are erased, so the output has no
 * external dependencies — it can be included next to `micrio.min.js` with a
 * plain `<script src="./grid.js" defer></script>`.
 *
 * Usage:
 *   node templates/grid/build-grid.js            # readable output
 *   node templates/grid/build-grid.js --minify   # minified output
 *
 * (esbuild is used here; it ships as a dependency of Vite. We shell out to its
 * CLI so this works regardless of how the package manager hoists it.)
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const isWin = process.platform === 'win32';
const esbuildBin = resolve(root, 'node_modules', '.bin', isWin ? 'esbuild.cmd' : 'esbuild');
const minify = process.argv.includes('--minify');

const args = [
	resolve(here, 'grid.ts'),
	'--bundle',
	'--format=iife',
	'--target=es2022',
	`--outfile=${resolve(here, 'grid.js')}`,
	'--log-level=info',
	...(minify ? ['--minify'] : []),
];

execFileSync(esbuildBin, args, { stdio: 'inherit' });

console.log(`Built templates/grid/grid.js${minify ? ' (minified)' : ''}`);
