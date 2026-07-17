import fs from 'fs';
import path from 'path';

const version = process.env.npm_package_version;
const outFile = `./public/dist/micrio.min.js`;
const buildDir = './public/build/';

// ── Assemble CSS from component static styles ──
const cssFiles = [];
const walk = (dir) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'svelte' || entry.name === 'node_modules') continue;
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

// Fix double vite/svelte classname hash selectors
let cssContent = fs.readFileSync(files.css).toString();
const matches = cssContent.match(/\.([^\d\.{ ):>,]+)/mig);
if (matches) {
	matches.filter((s, i) => matches.indexOf(s) == i).forEach(sel => {
		const reg = new RegExp(`(${sel.replace('.', '\\.')}){2,}`, 'mig');
		if (reg.test(cssContent)) cssContent = cssContent.replace(reg, sel);
	});
	fs.writeFileSync(files.css, cssContent);
}

// Strip `static{this.styles="..."}` from compiled JS (CSS is already in the blob above)
let jsRaw = fs.readFileSync(files.js).toString();
jsRaw = jsRaw.replace(/static\{this\.styles=(['"`])(?:(?!\1)[\s\S])*\1\}/g, '');
fs.writeFileSync(files.js, jsRaw);

// Prepend CSS style injection to the JS bundle
const escapedCss = cssContent.replace(/[$`]/g, '\\$&');
const jsContent = `const _css=document.createElement('style');
_css.className='micrio-interface';_css.textContent=\`${escapedCss}\`;
document.head.insertBefore(_css,document.head.firstChild);
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

console.info('\x1b[36m%s\x1b[0m', `created ${outFile}`);

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

console.info('\x1b[36m%s\x1b[0m', `created ${dFile}`);
