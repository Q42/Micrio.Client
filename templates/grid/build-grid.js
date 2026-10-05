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
 * (Bundled through Vite's JS API. Vite 8 builds on rolldown and no longer
 * ships esbuild, so the old esbuild CLI shell-out had nothing to run.)
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const minify = process.argv.includes('--minify')

await build({
	configFile: false,
	root: resolve(here, '..', '..'),
	logLevel: 'info',
	build: {
		outDir: here,
		emptyOutDir: false,
		copyPublicDir: false,
		target: 'es2022',
		minify: minify ? 'terser' : false,
		lib: {
			entry: resolve(here, 'grid.ts'),
			formats: ['iife'],
			name: 'MicrioGrid',
			fileName: () => 'grid.js',
		},
		// esbuild emitted this by default; keep the module running in strict mode.
		rollupOptions: { output: { banner: '"use strict";' } },
	},
})

console.log(`Built templates/grid/grid.js${minify ? ' (minified)' : ''}`)
