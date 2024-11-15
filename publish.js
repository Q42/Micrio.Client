// Publish the Micrio Client package to the NPM registry and Micrio CDNs

import fs from 'fs';
import { exec } from 'child_process';

const run = (cmd) => new Promise((ok,error) => exec(cmd, (err, stdout, stderr) => {
	if(stderr) error(stderr); else ok(stdout||err);
}));
const error = (err) => {
	console.error('\nAn error has occurred: '+err);
	process.exit();
}

const version = process.env.npm_package_version;

const jsFile = './public/dist/micrio.min.js';
const exists = fs.existsSync(jsFile);
if(!exists) console.warn('Compiled Micrio JS not found.');

const isCurrentVersion = exists && fs.readFileSync(jsFile, 'utf8').split('\n')[0].indexOf(version) > 0;
if(exists && !isCurrentVersion) console.warn('Compiled version is not the latest version.')

if(!isCurrentVersion) {
	process.stdout.write('\nBuilding... ');
	await run('npm run build').catch(error);
	console.log('done.\n')
}

// Publish to NPM registry
process.stdout.write('\nPublishing to NPM registry... ');
await run('npm publish ./public/dist --access public').catch(error);
console.log('done.\n')

// Publish JS to Cloudflare R2
console.warn(`Publishing version ${version} to Micrio CDNs`);
for(const bucket of ['micrio','-J eu micrio-eu']) {
	console.log(`https://${bucket=='micrio'?'r2':'eu'}.micr.io/micrio-${version}.min.js`);
	for(const ext of ['js','d.ts']) await run(`wrangler r2 object put ${bucket}/micrio-${version}.min.${ext} -f ./public/dist/micrio.min.${ext}`);
}

// When all is succesful, bump the current version number
const tv = version.split('.'); tv[2]++;
const newVersion = tv.join('.');

for(const json of ['package.json', './public/dist/package.json'])
	fs.writeFileSync(json, fs.readFileSync(json, 'utf-8')
		.replace(/"version": ".*"/m,`"version": "${newVersion}"`));

const tsVersion = './src/ts/version.ts';
fs.writeFileSync(tsVersion, fs.readFileSync(tsVersion, 'utf-8')
	.replace(/VERSION = '.*'/m,`VERSION = '${newVersion}'`));

console.log('\nPublish completed. New working version: ' + newVersion);
