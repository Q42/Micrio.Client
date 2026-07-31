import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const version = process.env.npm_package_version;
const outFile = `./public/dist/micrio.min.js`;
const buildDir = './public/build/';

const book3dFile = './public/micrio-book3d.js';
const hasBook3d = fs.existsSync(book3dFile);
if(hasBook3d) console.log(`Including optional module: ${book3dFile}`);

const jsPath = buildDir + 'micrio.prod.iife.js';
const cssPath = buildDir + 'micrio.prod.css';

// Deduplicate repeated classname hash selectors in CSS
let cssContent = fs.readFileSync(cssPath, 'utf-8');
const matches = cssContent.match(/\.([^\d\.{ ):>,]+)/mig);
if (matches) {
	[...new Set(matches)].forEach(sel => {
		const reg = new RegExp(`(${sel.replace('.', '\\.')}){2,}`, 'mig');
		cssContent = cssContent.replace(reg, sel);
	});
}

// Minify CSS
cssContent = cssContent
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*([{};,])\s*/g, '$1')
  .replace(/:\s+/g, ':')
  .replace(/;}/g, '}')
  .replace(/\s+/g, ' ');

// Strip `static styles="..."` / `static styles='...'` / `static styles=\`...\`` from compiled JS & prepend CSS
let jsRaw = fs.readFileSync(jsPath).toString();
jsRaw = jsRaw.replace(/static\s+styles\s*=\s*(['"`])(?:(?!\1)[\s\S])*?\1\s*;?/g, '');
const escapedCss = cssContent.replace(/[$`]/g, '\\$&');
const jsContent = `const _style=document.createElement('style');_style.className='micrio-interface';_style.textContent=\`${escapedCss}\`;document.head.insertBefore(_style,document.head.firstChild);
${jsRaw}`;
fs.writeFileSync(jsPath, jsContent);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, Buffer.concat([
	Buffer.from([
		`/* Micrio Client ${version}`,
		...fs.readFileSync('./LICENSE').toString().trim().split('\n').map(r => ' * ' + r.trim()),
		' */\n\n'
	].join('\n')),
	Buffer.from(fs.readFileSync(jsPath)),
	...(hasBook3d ? [Buffer.from('\n'), Buffer.from(fs.readFileSync(book3dFile))] : [])
]));

// Generate .d.ts
const dFile = outFile.replace('.js', '.d.ts');
const dtsInput = fs.readFileSync('./out.d.ts', 'utf-8');
const modules = parseDeclareModules(dtsInput);
const internalNames = new Set(modules.keys());
const dtsBundled = bundleDts(modules, internalNames);
fs.writeFileSync(dFile, dtsBundled);
fs.rmSync('./out.d.ts');
fs.rmSync(jsPath);
fs.rmSync(cssPath);
fs.rmdirSync(buildDir);

const formatSize = (bytes) => {
	const k = 1024;
	const sizes = ['B', 'kB', 'MB'];
	const i = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
	return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

const gzipSize = (filePath) => zlib.gzipSync(fs.readFileSync(filePath)).length;

console.info();
console.info(`\x1b[2mFinal output:\x1b[0m`);

const f = outFile;
const raw = fs.statSync(f).size;
const gz = gzipSize(f);
console.info(` \x1b[38;2;0;212;238m\u25C8\x1b[0m \x1b[32m${path.relative('.', f)}\x1b[0m      \x1b[1m${formatSize(raw).padStart(9)}\x1b[0m \u2502 gzip: ${formatSize(gz)}`);

function parseDeclareModules(input) {
	const modules = new Map();
	const lines = input.split('\n');
	let currentName = null;
	let braceDepth = 0;
	let contentLines = [];
	let insideModule = false;

	for (const line of lines) {
		const singleMatch = line.match(/^declare module "([^"]+)" \{(.*)\}$/);
		if (singleMatch) {
			modules.set(singleMatch[1], singleMatch[2] === '' ? '' : singleMatch[2]);
			continue;
		}

		const multiMatch = line.match(/^declare module "([^"]+)" \{$/);
		if (multiMatch && !insideModule) {
			currentName = multiMatch[1];
			insideModule = true;
			braceDepth = 1;
			contentLines = [];
			continue;
		}

		if (insideModule) {
			for (const ch of line) {
				if (ch === '{') braceDepth++;
				if (ch === '}') braceDepth--;
			}

			if (braceDepth <= 0) {
				modules.set(currentName, contentLines.join('\n'));
				insideModule = false;
				currentName = null;
				contentLines = [];
			} else {
				contentLines.push(line);
			}
		}
	}

	return modules;
}

function bundleDts(modules, internalNames) {
	const inlining = new Set();
	const inlinedModules = new Set();

	function inlineModule(name, extraIndent) {
		extraIndent = extraIndent || 0;

		if (inlining.has(name)) return '';
		if (inlinedModules.has(name)) return '';
		inlining.add(name);

		const content = modules.get(name);
		if (!content || content.trim() === '') {
			inlining.delete(name);
			inlinedModules.add(name);
			return '';
		}

		const lines = content.split('\n');
		const result = [];

		for (const line of lines) {
			const trimmed = line.trim();

			if (!trimmed) {
				result.push(line);
				continue;
			}

			const indent = line.match(/^\s*/)[0];

			const nsExport = trimmed.match(/^export \* as (\w+) from "([^"]+)"\s*;?$/);
			if (nsExport) {
				const srcModule = nsExport[2];
				if (internalNames.has(srcModule)) {
					const childContent = inlineModule(srcModule, extraIndent + 1);
					if (childContent) {
						result.push(`${indent}export namespace ${nsExport[1]} {`);
						result.push(childContent);
						result.push(`${indent}}`);
					}
					continue;
				}
				result.push(line);
				continue;
			}

			const starExport = trimmed.match(/^export \* from "([^"]+)"\s*;?$/);
			if (starExport) {
				const srcModule = starExport[1];
				if (internalNames.has(srcModule)) {
					const childContent = inlineModule(srcModule, extraIndent);
					if (childContent) {
						result.push(childContent);
					}
					continue;
				}
				result.push(line);
				continue;
			}

			if (trimmed.startsWith('import "') || trimmed.startsWith("import '")) {
				continue;
			}

			const importAliasMatch = trimmed.match(/^import(?:\s+type)?\s+\{\s*(\w+)\s+as\s+(\w+)\s*\}\s+from\s+"([^"]+)"\s*;?$/);
			if (importAliasMatch) {
				const srcModule = importAliasMatch[3];
				if (internalNames.has(srcModule)) {
					result.push(`${indent}type ${importAliasMatch[2]} = ${importAliasMatch[1]};`);
					continue;
				}
				result.push(line);
				continue;
			}

			const importMatch = trimmed.match(/^import(?:\s+type)?\s+(?:\{[^}]*\}|[^\s]+)\s+from\s+"([^"]+)"\s*;?$/);
			if (importMatch) {
				const srcModule = importMatch[1];
				if (internalNames.has(srcModule)) {
					continue;
				}
				result.push(line);
				continue;
			}

			result.push(line);
		}

		inlining.delete(name);
		inlinedModules.add(name);

		const output = result.join('\n');
		if (extraIndent > 0 && output) {
			const indentStr = '\t'.repeat(extraIndent);
			return output.split('\n').map(l => l ? indentStr + l : l).join('\n');
		}
		return output;
	}

	const modelsContent = inlineModule('types/models', 0);

	const processed = [];
	for (const name of internalNames) {
		if (name === 'types/models' || name === 'types/models/index') continue;
		if (inlinedModules.has(name)) continue;
		const content = inlineModule(name, 0);
		if (content) {
			processed.push(content);
		}
	}

	if (modelsContent) processed.unshift(modelsContent);

	return `declare module '@micrio/client' {\n${processed.join('\n\n')}\n}`;
}
