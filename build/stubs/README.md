# Minimal-build stubs

TypeScript stubs that `vite.config.js` aliases in for the **minimal** build (`vite build
--mode minimal`), standing in for the modules that build leaves out: the embed, media, tour,
marker, book, grid, gallery, audio and controller/layout-UI layers.

They are build _inputs_, not build output — `vite build` writes to `public/build/`.

`empty.ts` is the stub for everything the remaining code only imports for its side effects or
never reaches. The named stubs (`grid.ts`, `omni.ts`, `gallery-controller.ts`,
`audio-controller.ts`, `book-main.ts`, `postprocess.ts`, `archive.ts`, `i18n-strings.ts`)
export the small surface the core build still touches, so the minimal bundle stays small
without the excluded modules having to be tree-shaken away.
