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

You need to have `wrangler` installed globally, and have a `CLOUDFLARE_API_TOKEN` with write access to the bucket set in `.env`.


```sh
$ npm run publish
```


## Changelog

Check out `CHANGELOG.md` for the changelog.

Good luck!

[Marcel](mailto:marcel@micr.io)
