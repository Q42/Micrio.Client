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
