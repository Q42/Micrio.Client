import zlib from 'zlib';
import fs from 'fs';

const embed = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).toString('base64').replace(/\//g,'$').replace(/O/g,'#');

const version = process.env.npm_package_version;
const outFile = `./public/dist/micrio.min.js`;
const buildDir = './public/build/';

const files=  {
	css: buildDir+'micrio.prod.css',
	js: buildDir+'micrio.prod.iife.js',
	wasm: buildDir+'optimized.wasm'
}

// Fix double vite/svelte classname hash selectors
let file = fs.readFileSync(files.css).toString();
const matches = file.match(/\.([^\d\.{ ):>,]+)/mig);
matches.filter((s,i) => matches.indexOf(s)==i).forEach(sel => {
	const reg = new RegExp(`(${sel.replace('.','\\.')}){2,}`,'mig');
	if(reg.test(file)) file = file.replace(reg, sel);
});
fs.writeFileSync(files.css, file);

// Wasm params
file = `const [_c,_u,_b]=arguments,_css=document.createElement('style');
_css.className='micrio-interface';_css.textContent=_c;
document.head.insertBefore(_css,document.head.firstChild);
`+fs.readFileSync(files.js).toString()
	.replace('{b64:"EXTERNAL_WASM"}','{b64:_b,ugz:_u}');
fs.writeFileSync(files.js, file);

fs.writeFileSync(outFile, Buffer.concat([
	Buffer.from([
		`/* Micrio Client ${version}`,
		...fs.readFileSync('./LICENSE').toString().trim().split('\n').map(r => ' * ' + r.trim()),
		' */\n\n'
	].join('\n')),
	Buffer.from([
		"((M,I,C,R='O')=>{\n",
			"if(!(typeof window !== undefined && typeof window !== 'undefined')) return;",
			`M='${embed(files.wasm)}',`,
			"I=window.DecompressionStream,",
			"C=(b,t,d,a)=>",
				"(a=atob(b.replace(/\\$/g,'/').replace(/#/g,'O')).split('').map(x=>x.charCodeAt(0)),",
				"d=I?new Response(new Blob([new Uint8Array(a)]).stream().pipeThrough(new I('gzip'))):(new Zlib.Gunzip(a)).decompress())",
				"&&(I?t?d.arrayBuffer():d.text():t?d:new self.TextDecoder('utf-8').decode(d));",
			"(I?new Promise(a=>a()):fetch('https://r2.micr.io/gunzip.min.js').then(r=>r.text()).then(js=>Function(js)())).then(()=>",
			`(function(){${fs.readFileSync(files.js)}})(\`${fs.readFileSync(files.css)}\`,C,M))`,
		"})();",
	].join(''))
]));

console.log();
console.info('\x1b[36m%s\x1b[0m', `created ${outFile}`);

const dFile = outFile.replace('.js','.d.ts');
fs.writeFileSync(dFile, Buffer.concat([
	Buffer.from([
		"declare module '@micrio/client' {",
		"\timport type { Readable, Writable } from 'svelte/store';",
		...fs.readFileSync('./out.d.ts').toString().replace(/    /mg,'\t').split('\n').filter(l => /^\s/.test(l) && !/^\s*import/.test(l)),
		"}"
	].join('\n')),
	fs.readFileSync('./docs/store.d.ts.txt')
]));
fs.rmSync('./out.d.ts');
fs.rmSync(files.css);
fs.rmSync(files.js);

fs.writeFileSync('./src/ts/version.ts', `export const VERSION = '${version}';\n`);

console.info('\x1b[36m%s\x1b[0m', `created ${dFile}`);
