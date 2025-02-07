import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	build: {
		outDir: './public/build/',
		emptyOutDir: false,
		copyPublicDir: false,
		minify: 'terser',
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
