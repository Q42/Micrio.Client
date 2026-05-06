import fs from 'fs';

const version = process.env.npm_package_version;
const outFile = `./public/dist/micrio.min.js`;
const buildDir = './public/build/';

const files = {
	css: buildDir + 'micrio.prod.css',
	js: buildDir + 'micrio.prod.iife.js',
}

// Fix double vite/svelte classname hash selectors
let cssContent = fs.readFileSync(files.css).toString();
const matches = cssContent.match(/\.([^\d\.{ ):>,]+)/mig);
matches.filter((s, i) => matches.indexOf(s) == i).forEach(sel => {
	const reg = new RegExp(`(${sel.replace('.', '\\.')}){2,}`, 'mig');
	if (reg.test(cssContent)) cssContent = cssContent.replace(reg, sel);
});
fs.writeFileSync(files.css, cssContent);

// Prepend CSS style injection to the JS bundle
const jsContent = `const _css=document.createElement('style');
_css.className='micrio-interface';_css.textContent=\`${cssContent}\`;
document.head.insertBefore(_css,document.head.firstChild);
${fs.readFileSync(files.js)}`;
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
		"\timport type { Readable, Writable } from 'svelte/store';",
		...fs.readFileSync('./out.d.ts').toString().replace(/    /mg, '\t').split('\n').filter(l => /^\s/.test(l) && !/^\s*import/.test(l)),
		"}"
	].join('\n')),
	fs.readFileSync('./docs/store.d.ts.txt')
]));
fs.rmSync('./out.d.ts');
fs.rmSync(files.css);
fs.rmSync(files.js);
fs.rmdirSync(buildDir);

console.info('\x1b[36m%s\x1b[0m', `created ${dFile}`);
