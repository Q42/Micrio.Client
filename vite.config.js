import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const defaultAliases = {
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
};

const stub = (file) => resolve('build/stubs/' + file);

// The `core` build excludes book/grid/audio/embed/media/tour/markers by stubbing
// every import that kept source files make into those directories. Exact-match
// entries must come before the generic `$media/*`-style aliases below.
const coreStubAliases = [
	{ find: '$media/subtitles', replacement: stub('empty.ts') },
	{ find: '$media/fullscreen', replacement: stub('empty.ts') },
	{ find: '$media/media-controls', replacement: stub('empty.ts') },
	{ find: '$media/media', replacement: stub('empty.ts') },
	{ find: '$embed/embed', replacement: stub('empty.ts') },
	{ find: '$embed/image-embeds', replacement: stub('empty.ts') },
	{ find: '$tour/tour', replacement: stub('empty.ts') },
	{ find: '$tour/serial-tour', replacement: stub('empty.ts') },
	{ find: '$grid/grid', replacement: stub('grid.ts') },
	{ find: '$audio/audio-controller', replacement: stub('audio-controller.ts') },
	{ find: '$book/main', replacement: stub('book-main.ts') },
	{ find: '$markers/waypoint', replacement: stub('empty.ts') },
	{ find: '$markers/marker-content', replacement: stub('empty.ts') },
	{ find: '$markers/marker-popup', replacement: stub('empty.ts') },
	{ find: '$markers/marker', replacement: stub('empty.ts') },
	{ find: '$markers/markers', replacement: stub('empty.ts') },
	{ find: '$layout/toolbar', replacement: stub('empty.ts') },
	{ find: '$gallery/omni', replacement: stub('omni.ts') },
	{ find: '$layout/logo', replacement: stub('empty.ts') },
	{ find: '$layout/article', replacement: stub('empty.ts') },
	{ find: '$layout/details', replacement: stub('empty.ts') },
	{ find: '$layout/logo-org', replacement: stub('empty.ts') },
	{ find: '$layout/menu', replacement: stub('empty.ts') },
	{ find: '$layout/popover', replacement: stub('empty.ts') },
	{ find: '$ui/progress-circle', replacement: stub('empty.ts') },
	{ find: '$ui/dial', replacement: stub('empty.ts') },
	{ find: '$layout/nav/controls', replacement: stub('empty.ts') },
	{ find: '$layout/nav/zoom-buttons', replacement: stub('empty.ts') },
	{ find: '$gallery/gallery', replacement: stub('empty.ts') },
	{ find: '$gallery/controller', replacement: stub('gallery-controller.ts') },
	{ find: '$ui/button', replacement: stub('empty.ts') },
	{ find: '$ui/button-group', replacement: stub('empty.ts') },
	{ find: '$ui/icon', replacement: stub('empty.ts') },
	{ find: '$ui/icons', replacement: stub('empty.ts') },
	{ find: '$core/i18n/strings', replacement: stub('i18n-strings.ts') },
	{ find: '$core/element-ui', replacement: stub('empty.ts') },
	{ find: '$render/postprocess', replacement: stub('postprocess.ts') },
	{ find: '$utils/archive', replacement: stub('archive.ts') },
];

export default defineConfig(({ mode }) => {
	const core = mode === 'minimal';

	return {
		plugins: [glslMinifyPlugin()],
		resolve: {
			alias: core
				? [...coreStubAliases, ...Object.entries(defaultAliases).map(([find, replacement]) => ({ find, replacement }))]
				: defaultAliases,
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
			fileName: core ? `micrio.prod.core` : `micrio.prod`,
			formats: ['iife']
		},
		rollupOptions: {
			output: {

				assetFileNames: () => `micrio.prod${core ? '.core' : ''}[extname]`
			}
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
