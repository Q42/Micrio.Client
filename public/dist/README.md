# Micrio Client

If you are looking for HOWTOs, tutorials, or general Micrio help, please check out our
searchable Knowledge Base at:

[https://doc.micr.io/](https://doc.micr.io/)

## Installation

```bash
npm i @micrio/client
```

## Usage

Since the Micrio Client is a passive binding for all HTML `<micr-io>` elements, all you need to do to include Micrio in your project or page is:

```js
import '@micrio/client'
```

## Core build

If you only need tiled-image viewing (including IIIF) and none of the extended
viewer types, a smaller `micrio.core.min.js` is available alongside the full
build. It excludes the book, grid, audio, embed, media, markers, and tour
modules, as well as the toolbar, controls, gallery (and its controller),
omni (3D object), logo, article, details, menu, dial, popover, and button UI,
along with the translation bundles and icon graphics.

```js
import '@micrio/client/micrio.core.min.js'
```

Imagery whose data relies on an excluded feature will simply not render that
feature rather than erroring out.

## Typed

To get typed access to a Micrio HTML element, you can use the `HTMLMicrioElement` as exported by this package:

```ts
import type { HTMLMicrioElement } from '@micrio/client';

// This will be a fully typed element
const micrioElement = document.querySelector('micr-io') as HTMLMicrioElement;
```

## Upgrading to the latest version (v7)

If you are using Micrio inside your project, and have custom CSS and/or using the JS API, check out this document which has all changes from earlier versions:

https://doc.micr.io/client/v7/changes.html
