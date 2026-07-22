import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const version = process.env.npm_package_version;
const outFile = `./public/dist/micrio.min.js`;
const buildDir = './public/build/';

// ── Assemble CSS from component .css files ──
const cssFiles = [];
const walk = (dir) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else if (entry.isFile() && entry.name.endsWith('.css')) cssFiles.push(full);
	}
};
walk('./src/');

const cssParts = [];
for (const file of cssFiles) {
	cssParts.push(fs.readFileSync(file, 'utf-8'));
}

// ── Bundle ──
const jsPath = buildDir + 'micrio.prod.iife.js';

// Deduplicate repeated classname hash selectors in assembled CSS
let cssContent = cssParts.join('\n\n');
const matches = cssContent.match(/\.([^\d\.{ ):>,]+)/mig);
if (matches) {
	[...new Set(matches)].forEach(sel => {
		const reg = new RegExp(`(${sel.replace('.', '\\.')}){2,}`, 'mig');
		cssContent = cssContent.replace(reg, sel);
	});
}

// Minify CSS
cssContent = cssContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n/g, '').replace(/[ \t]+/g, ' ').replace(/\s*([{};,:])\s*/g, '$1').trim();

// Strip `static styles="..."` / `static styles='...'` / `static styles=\`...\`` from compiled JS & prepend CSS
let jsRaw = fs.readFileSync(jsPath).toString();
jsRaw = jsRaw.replace(/static\s+styles\s*=\s*(['"`])(?:(?!\1)[\s\S])*?\1\s*;?/g, '');
const escapedCss = cssContent.replace(/[$`]/g, '\\$&');
const jsContent = `const _style=document.createElement('style');_style.className='micrio-interface';_style.textContent=\`${escapedCss}\`;document.head.insertBefore(_style,document.head.firstChild);
${jsRaw}`;
fs.writeFileSync(jsPath, jsContent);

fs.writeFileSync(outFile, Buffer.concat([
	Buffer.from([
		`/* Micrio Client ${version}`,
		...fs.readFileSync('./LICENSE').toString().trim().split('\n').map(r => ' * ' + r.trim()),
		' */\n\n'
	].join('\n')),
	Buffer.from(fs.readFileSync(jsPath))
]));

// Generate .d.ts
const dFile = outFile.replace('.js', '.d.ts');
fs.writeFileSync(dFile, Buffer.concat([
	Buffer.from([
		"declare module '@micrio/client' {",
		...fs.readFileSync('./out.d.ts').toString().replace(/    /mg, '\t').split('\n').filter(l => /^\s/.test(l) && !/^\s*import/.test(l)),
		"}"
	].join('\n'))
]));
fs.rmSync('./out.d.ts');
fs.rmSync(jsPath);
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
