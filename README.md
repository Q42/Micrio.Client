[![Micrio](https://b.micr.io/_statics/img/micrio-logo.png)](https://micr.io/)

# Micrio Client

If you are looking for HOWTOs, tutorials, or general Micrio help, please check out our
searchable Knowledge Base at:

[https://doc.micr.io/](https://doc.micr.io/)

## Getting it running

Make sure you have `npm` and `pnpm` installed.

Make sure you are in this directory. From there, run:

```sh
# This will install all necessary dependencies: Svelte, TypeScript and all WebAssembly stuff
$ pnpm i

# Compile the WebAssembly module for first time use
$ npm run asbuild:optimized
```

To run the dev env:

```sh
$ npm run dev
```

This will start a webserver on `http://localhost:2000/` will auto update to any changes made in the `./ts` and `./svelte` dirs.

## Working in WebAssembly

Since the web client uses a binary `wasm` file for the WebAssembly engine, you need to recompile to it after you've made any changes in the `./src/wasm` dir:

```sh
$ npm run asbuild:optimized
```

This will create a new `wasm` binary which will be used the next time you reload.

## Compilation

To build the production client viewer JS:

```sh
$ npm run build
```

This will bundle all compiled resources and create the final JS lib and TS declaration files in `./public/dist`:

* `micrio-{version}.min.js`
* `micrio-{version}.min.d.ts`

## Deploying a new Micrio version

(For admins only)

You need to have `wrangler` installed globally, and have a `CLOUDFLARE_API_TOKEN` with write access to the bucket set in `.env`.

Secondly, you need to have write access to the npm repository of `@micrio/client`.

To publish, do:

```sh
$ npm run publish
```

After this, if everything goes well, the current working version will be automatically increased.

**Before you do your next commit**, create a new release based on the current state at https://github.com/Q42/Micrio.Client/releases/new :

1. Create a new tag with the version just published (ie `v5.1.1`)
2. Auto-generate the release notes
3. Publish the release
4. Then commit the newly updated version changes

## Changelog

Check out `CHANGELOG.md` for the changelog.

Good luck!

[Marcel](mailto:marcel@micr.io)
