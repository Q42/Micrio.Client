[![Micrio](https://b.micr.io/_statics/img/micrio-logo.png)](https://micr.io/)

# Micrio Client

If you are looking for HOWTOs, tutorials, or general Micrio help, please check out our
searchable Knowledge Base at:

[https://doc.micr.io/](https://doc.micr.io/)

## NPM package

For the npm package `@micrio/client`, see https://www.npmjs.com/package/@micrio/client

## Getting it running

Make sure you have Node and `pnpm` installed.

Make sure you are in this directory. From there, run:

```sh
# This will install all necessary dependencies: Svelte, TypeScript and all WebAssembly stuff
$ pnpm i

# Compile the WebAssembly module for first time use
$ pnpm run asbuild:optimized
```

To run the dev env:

```sh
$ pnpm run dev
```

This will start a webserver on `http://localhost:2000/` which will auto reload to any changes made in the `./src` dir.

## Working in WebAssembly

Since the web client uses a binary `wasm` file for the WebAssembly engine, you need to recompile it after you've made changes in the `./src/wasm` dir:

```sh
$ pnpm run asbuild:optimized
```

If you want more debugging/stack tracing of your compiled wasm, run:

```sh
$ pnpm run asbuild:untouched
```

And make sure that `ts/wasm.ts` references `/build/untouched.wasm`.

This will create a new `wasm` binary which will be used the next time you reload.

## Compilation

To build the production client viewer JS:

```sh
$ pnpm run build
```

This will bundle all compiled resources and create the final JS lib and TS declaration files in `./public/dist`:

* `micrio.min.js`
* `micrio.min.d.ts`

If you want to test out the compiled version, check out `./index.html` and set the JS include to the compiled JS rather than the development version.

## Deploying a new Micrio version

(For admins only)

You need to have `wrangler` installed globally, and have a `CLOUDFLARE_API_TOKEN` with write access to the bucket set in `.env`.

Secondly, you need to have write access to the npm repository of `@micrio/client`.

To publish to both the hosted JS and NPM, and do an automatic version increase, do:

```sh
$ pnpm run publish -- --npm
```

After this, if everything goes well, the current working version will be automatically increased.

**Before you do your next commit**, create a new release based on the current state at https://github.com/Q42/Micrio.Client/releases/new :

1. Create a new tag with the version just published (ie `v5.1.1`)
2. Auto-generate the release notes
3. Publish the release
4. Then commit the newly updated version changes

If you only want to update the hosted version, omit the `-- --npm` argument. This can be useful for testing, and having to add the argument is a safeguard for accidentally publishing a new version on NPM.

## Questions

If you have any questions, do check out https://doc.micr.io/ for all (technical) documentation.

If you have a reproducable issue, please submit a ticket at https://support.micr.io/ .

For any other questions, contact us at support@micr.io.

Good luck!

[Marcel Duin](mailto:support@micr.io)
