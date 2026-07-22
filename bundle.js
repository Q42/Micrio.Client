import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const version = process.env.npm_package_version;
const outFile = `./public/dist/micrio.min.js`;
const buildDir = './public/build/';

// ── Assemble CSS from component static styles ──
const cssFiles = [];
const walk = (dir) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else if (entry.isFile() && entry.name.endsWith('.ts')) cssFiles.push(full);
	}
};
walk('./src/');

const cssParts = [];

// CSS custom properties (cssVars)
const cssVarsContent = fs.readFileSync('./src/core/css-vars.ts', 'utf-8');
const cssVarsMatch = cssVarsContent.match(/cssVars\s*=\s*`([\s\S]*?)`/);
if (cssVarsMatch?.[1]) cssParts.push(cssVarsMatch[1]);

// Component static styles
for (const file of cssFiles) {
	const content = fs.readFileSync(file, 'utf-8');
	const match = content.match(/static\s+styles\s*=\s*`([\s\S]*?)`/);
	if (match && match[1]) cssParts.push(match[1]);
}

fs.writeFileSync(buildDir + 'micrio.prod.css', cssParts.join('\n\n').replace(/\$\{cssVars\}/g, ''));

// ── Bundle ──
const files = {
	css: buildDir + 'micrio.prod.css',
	js: buildDir + 'micrio.prod.iife.js',
}

// Deduplicate repeated classname hash selectors in bundled CSS
let cssContent = fs.readFileSync(files.css).toString();
const matches = cssContent.match(/\.([^\d\.{ ):>,]+)/mig);
if (matches) {
	matches.filter((s, i) => matches.indexOf(s) == i).forEach(sel => {
		const reg = new RegExp(`(${sel.replace('.', '\\.')}){2,}`, 'mig');
		if (reg.test(cssContent)) cssContent = cssContent.replace(reg, sel);
	});
	fs.writeFileSync(files.css, cssContent);
}

// ── Minify and deflate CSS ──
cssContent = cssContent.replace(/\n/g, '').replace(/[ \t]+/g, ' ').replace(/\s*([{};,:])\s*/g, '$1').trim();

// ── Deflate CSS: replace micr-* words with %N placeholders ──
const micrWords = [...new Set(cssContent.match(/\bmicr[\w-]+/g) || [])];
micrWords.sort((a, b) => b.length - a.length);
const cssSuffixes = micrWords.map(w => w.slice(4));
micrWords.forEach((word, i) => {
	cssContent = cssContent.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `%${String(i).padStart(2, '0')}`);
});

// Strip `static styles="..."` / `static styles='...'` / `static styles=\`...\`` from compiled JS
let jsRaw = fs.readFileSync(files.js).toString();
jsRaw = jsRaw.replace(/static\s+styles\s*=\s*(['"`])(?:(?!\1)[\s\S])*?\1\s*;?/g, '');
fs.writeFileSync(files.js, jsRaw);

// Prepend CSS style injection to the JS bundle
const escapedCss = cssContent.replace(/[$`]/g, '\\$&');
const suffixJson = JSON.stringify(cssSuffixes);
const jsContent = `const _inflate=(s,k)=>{for(let i=0;i<k.length;i++)s=s.replace(new RegExp('%'+(i<10?'0'+i:i),'g'),'micr'+k[i]);return s};const _css=_inflate(\`${escapedCss}\`,${suffixJson});const _style=document.createElement('style');_style.className='micrio-interface';_style.textContent=_css;document.head.insertBefore(_style,document.head.firstChild);
${jsRaw}`;
fs.writeFileSync(files.js, jsContent);

fs.writeFileSync(outFile, Buffer.concat([
	Buffer.from([
		`/* Micrio Client ${version}`,
		...fs.readFileSync('./LICENSE').toString().trim().split('\n').map(r => ' * ' + r.trim()),
		' */\n\n'
	].join('\n')),
	Buffer.from(fs.readFileSync(files.js))
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
fs.rmSync(files.css);
fs.rmSync(files.js);
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
