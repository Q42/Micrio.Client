import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
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
	},
	plugins: [
		svelte({
			preprocess: vitePreprocess(),
			compilerOptions: {
				// Kebabcase classnames
				cssHash: ({name}) => 'micrio-'+name.split('').map((letter, idx) =>
					letter.toUpperCase() === letter ? `${idx !== 0 ? '-' : ''}${letter.toLowerCase()}` : letter
				).join('')
			}
		})
	]
});
