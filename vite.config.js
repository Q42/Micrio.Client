import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
	resolve: {
		alias: {
			'$ts': resolve('src/ts'),
			'$types': resolve('src/types'),
			'$engine': resolve('src/engine'),
			'$media': resolve('src/media'),
		}
	},
	define: {
		__VERSION__: JSON.stringify(pkg.version),
	},
	build: {
		outDir: './public/build/',
		emptyOutDir: false,
		copyPublicDir: false,
		minify: 'terser',
		terserOptions: {
			compress: {
				pure_funcs: ['console.log']
			}
		},
		lib: {
			entry: `./src/ts/main.ts`,
			name: 'Micrio',
			fileName: `micrio.prod`,
			formats: ['iife']
		},
		rollupOptions: {
			output: {
				globals: {
					'_c': '_c',
					'_u': '_u',
					'_b': '_b'
				},
				assetFileNames: () => `micrio.prod[extname]`
			}
		}
	}
});
