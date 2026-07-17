import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
	resolve: {
		alias: {
			'$types': resolve('src/types'),
			'$media': resolve('src/media'),
			'$core': resolve('src/core'),
			'$ui': resolve('src/ui'),
			'$markers': resolve('src/markers'),
			'$tour': resolve('src/tour'),
			'$gallery': resolve('src/gallery'),
			'$audio': resolve('src/audio'),
			'$embed': resolve('src/embed'),
			'$layout': resolve('src/layout'),
			'$render': resolve('src/render'),
			'$grid': resolve('src/grid'),
			'$utils': resolve('src/utils'),
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
			entry: `./src/main.ts`,
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
