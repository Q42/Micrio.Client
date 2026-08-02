import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
	plugins: [glslMinifyPlugin()],
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
				pure_funcs: ['console.log'],
				booleans_as_integers: true,
				passes: 6,
				unsafe_arrows: true,
				unsafe_comps: true,
				unsafe_math: true,
				unsafe_methods: true,
				unsafe_proto: true,
				unsafe_regexp: true,
				unsafe_undefined: true,
				drop_debugger: true,
				ecma: 2022,
			},
			mangle: {
				toplevel: false,
				keep_classnames: false,
				keep_fnames: false,
				properties: {
					// Mangle properties that start with an underscore
					regex: /^_/,
				},
			},
			format: {
				comments: false,
			},
		},
		lib: {
			entry: `./src/main.ts`,
			name: 'Micrio',
			fileName: `micrio.prod`,
			formats: ['iife']
		},
		rollupOptions: {
			output: {
		
				assetFileNames: () => `micrio.prod[extname]`
			}
		}
	}
});


function glslMinify(src) {
	return src
		.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '') // block comments
		.replace(/\/\/[^\n]*/g, '')                          // line comments
		.replace(/[ \t]+/g, ' ')                             // collapse horizontal whitespace
		.replace(/^[ \t]+/gm, '')                            // trim line starts
		.replace(/[ \t]+$/gm, '')                            // trim line ends
		.replace(/\n{2,}/g, '\n')                            // collapse blank lines
		.trim();
}

function glslMinifyPlugin() {
	return {
		name: 'glsl-minify',
		enforce: 'pre',
		async resolveId(id, importer) {
			if (id.endsWith('.glsl?raw')) {
				const resolved = await this.resolve(id.replace('?raw', ''), importer);
				if (resolved) return resolved.id;
			}
		},
		transform(src, id) {
			if (id.endsWith('.glsl')) return `export default ${JSON.stringify(glslMinify(src))};`;
		},
	};
}
