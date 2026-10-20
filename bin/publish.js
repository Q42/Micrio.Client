// Publish the Micrio Client package to the NPM registry and Micrio CDNs

import fs from 'fs'
import { exec } from 'child_process'

const run = (cmd) =>
	new Promise((ok, error) => {
		exec(cmd, (err, stdout, stderr) => {
			if (err) {
				error(err)
			} else {
				ok(stdout || stderr)
			}
		})
	})
const error = (err) => {
	console.error(`\nAn error has occurred: ${err}`)
	process.exit(1)
}

const version = process.env.npm_package_version

// Always build: a previous build for this same version number is
// indistinguishable from a stale one, so never trust what is in public/dist.
process.stdout.write('\nBuilding... ')
await run('npm run build').catch(error)
console.log('done.\n')

// Verify the build actually produced this version before publishing anything.
const jsFile = './public/dist/micrio.min.js'
const built = fs.existsSync(jsFile) && fs.readFileSync(jsFile, 'utf8').split('\n')[0].indexOf(version) > 0
if (!built) {
	error(`Build did not produce version ${version} in ${jsFile}`)
}

const args = process.argv.slice(2)

const npmPublish = args?.includes('--npm')
if (npmPublish) {
	const otp = args[args?.findIndex((a) => a.startsWith('--otp')) + 1]
	if (!otp) {
		console.log('\nError: enter your one-time-password using --otp to publish to NPM')
		process.exit(1)
	}
	// Publish to NPM registry
	process.stdout.write('\nPublishing to NPM registry... ')
	await run(`npm publish ./public/dist --access public --no-git-checks --otp ${otp}`).catch(error)
	console.log('done.\n')
}

// Publish JS to Cloudflare R2 via AWS CLI (S3-compatible API)
console.warn(`Publishing version ${version} to Micrio CDNs`)
const suffix = args?.find((a) => a.startsWith('--suffix='))?.split('=')[1] || ''

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const awsKey = process.env.AWS_ACCESS_KEY_ID
const awsSecret = process.env.AWS_SECRET_ACCESS_KEY
if (!accountId) {
	console.warn('CLOUDFLARE_ACCOUNT_ID not set')
}
if (!awsKey) {
	console.warn('AWS_ACCESS_KEY_ID not set')
}
if (!awsSecret) {
	console.warn('AWS_SECRET_ACCESS_KEY not set')
}
if (!accountId || !awsKey || !awsSecret) {
	console.error('\nError: CLOUDFLARE_ACCOUNT_ID, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY must all be set')
	process.exit(1)
}

const r2Endpoint = `https://${accountId}.r2.cloudflarestorage.com`
const r2EuEndpoint = `https://${accountId}.eu.r2.cloudflarestorage.com`

/** Runs async tasks one after the other, in order. */
const sequentially = (tasks) => tasks.reduce((chain, task) => chain.then(task), Promise.resolve())

const uploadTasks = []
for (const [bucket, domain, endpoint] of [
	['micrio', 'r2', r2Endpoint],
	['micrio-eu', 'eu', r2EuEndpoint],
]) {
	uploadTasks.push(() => {
		console.log(`https://${domain}.micr.io/micrio-${version}${suffix}.min.js`)
	})
	for (const [ext, type] of [
		['js', 'text/javascript'],
		['d.ts', 'text/plain'],
	]) {
		uploadTasks.push(() =>
			run(
				`aws s3 cp ./public/dist/micrio.min.${ext} s3://${bucket}/micrio-${version}${suffix}.min.${ext} --endpoint-url ${endpoint} --content-type ${type} --cache-control "public, max-age=31536000"`,
			).catch(error),
		)
	}
	uploadTasks.push(() => {
		console.log(`https://${domain}.micr.io/micrio-${version}${suffix}.core.min.js`)
	})
	uploadTasks.push(() =>
		run(
			`aws s3 cp ./public/dist/micrio.core.min.js s3://${bucket}/micrio-${version}${suffix}.core.min.js --endpoint-url ${endpoint} --content-type text/javascript --cache-control "public, max-age=31536000"`,
		).catch(error),
	)
}
await sequentially(uploadTasks)

if (npmPublish) {
	// When all is succesful, bump the current version number
	const tv = version.split('.')
	tv[2]++
	const newVersion = tv.join('.')

	for (const json of ['package.json', './public/dist/package.json']) {
		fs.writeFileSync(json, fs.readFileSync(json, 'utf-8').replace(/"version": ".*"/m, `"version": "${newVersion}"`))
	}

	console.log(`\nPublish completed. New working version: ${newVersion}`)
} else {
	console.log(
		'\nDone. To also publish to NPM, include the --npm param (npm run publish -- --npm --otp [your one-time password]).',
	)
}
