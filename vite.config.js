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
			'$book': resolve('src/book'),
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


const GLSL_OPERATORS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':', '.', ',', ';', '(', ')', '[', ']', '{', '}']);
const GLSL_COMPOUND_OPERATORS = new Set(['++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '&=', '|=', '^=']);

function stripOperatorSpaces(src) {
	let out = '';
	let pending = false;
	for (const c of src) {
		if (c === ' ' || c === '\t' || c === '\r') {
			pending = true;
			continue;
		}
		if (pending && out.length) {
			const prev = out[out.length - 1];
			const prevOp = GLSL_OPERATORS.has(prev);
			const curOp = GLSL_OPERATORS.has(c);
			const compound = prevOp && curOp && GLSL_COMPOUND_OPERATORS.has(prev + c);
			if (!(prevOp || curOp) || compound) out += ' ';
		}
		out += c;
		pending = false;
	}
	return out;
}

function joinMinifiedLines(out, line) {
	if (!out) return line;
	if (out.endsWith('\n')) return out + line;
	const last = out[out.length - 1];
	const lastOp = GLSL_OPERATORS.has(last);
	const firstOp = GLSL_OPERATORS.has(line[0]);
	if ((lastOp || firstOp) && !(lastOp && firstOp && GLSL_COMPOUND_OPERATORS.has(last + line[0]))) {
		return out + line;
	}
	return out + ' ' + line;
}

function glslMinify(src) {
	const lines = src
		.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, ' ') // block comments -> space (keeps token boundaries)
		.replace(/\/\/[^\n]*/g, '')                          // line comments
		.split('\n')
		.map(stripOperatorSpaces)
		.filter(Boolean);

	let out = '';
	for (const line of lines) {
		if (line[0] === '#') {
			out += (out && !out.endsWith('\n') ? '\n' : '') + line + '\n';
		} else {
			out = joinMinifiedLines(out, line);
		}
	}
	return out.trim();
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
