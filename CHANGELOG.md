# Changelog

Legend:

|||
|--|--|
|&#x2705;|A feature has been added|
|&#x274C;|A feature has been deprecated/removed|
|&#x1F9F0;|An update/upgrade under the hood|
|&#x1F4E2;|Breaking change, upgrading or using an older version could break on this|
|&#x1F53C;|Requires the latest Micrio Dashboard (2024)|


* ## &#x1F4AB; 5.4.1 - 2025/08/28

	### Links
	* [GitHub](https://github.com/Q42/Micrio.Client/)
	* [NPM repository](https://www.npmjs.com/package/@micrio/client)
	* [JavaScript library](https://r2.micr.io/micrio-5.4.1.min.js)
	* [TypeScript declarations include](https://r2.micr.io/micrio-5.4.1.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/5.4.1/index.html)

	### Changes
	* A lot of internal rewrites and optimizations
	* Lots of bugfixes
	* Improved 360&deg; rendering performance
	* &#x1F4E2; *IMPORTANT*: Switched viewport models from `[x0,y0,x1,y1]` to `[x0,y0,width,height]` to accommodate for better viewports in 360&deg; images. While the viewer remains backwards compatible for older images, the client API now uses the new model. So if you have custom viewport logic in your app, review it before upgrading to Micrio 5.4!


* ## &#x1F4AB; 5.3.2 - 2025/04/04

	### Links
	* [GitHub](https://github.com/Q42/Micrio.Client/)
	* [NPM repository](https://www.npmjs.com/package/@micrio/client)
	* [JavaScript library](https://r2.micr.io/micrio-5.3.2.min.js)
	* [TypeScript declarations include](https://r2.micr.io/micrio-5.3.2.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/5.3.2/index.html)

	### Changes
	* Upgraded from Svelte 4 to Svelte 5
	* Added AI-generated and assisting documentation


* ## &#x1F4AB; 5.2.0 - 2025/03/26

	* Open sourced the client! See it at https://github.com/Q42/Micrio.Client/
	* There is now a `@micrio/client` NPM package too! See https://www.npmjs.com/package/@micrio/client
	* Started using `major.minor.patch` semantic versioning

	### Links
	* [GitHub](https://github.com/Q42/Micrio.Client/)
	* [NPM repository](https://www.npmjs.com/package/@micrio/client)
	* [JavaScript library](https://r2.micr.io/micrio-5.2.0.min.js)
	* [TypeScript declarations include](https://r2.micr.io/micrio-5.2.0.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/5.2.0/index.html)


* ## &#x1F4AB; 5.1 - 2024/08/26

	Under development.

	### Links
	* [JavaScript library](https://r2.micr.io/micrio-5.1.min.js)
	* [TypeScript declarations include](https://r2.micr.io/micrio-5.1.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/5.1/index.html)

	### Changes
	* To prevent class name overwriting issues with frameworks like Vue, state-related classnames on the main `<micr-io>` element have been changed:
		* Classname `hooked` to attribute `data-hooked`
		* Classname `panning` to attribute `data-panning`
		* Classname `pinching` to attribute `data-pinching`
		* Classname `can-pan` to attribute `data-can-pan`
		* Classname `loaded` to `data-loaded`
		* Classname `tour-active` to `data-tour-active`
		* Classname `videotour-playing` to `data-videotour-playing`
		* Classname `switching` to `data-switching`
		* Classname `micrio-light-mode` to `data-light-mode`
		* Classname `micrio-auto-scheme` to `data-auto-scheme`
		* Classname `is-fullscreen` has been removed, use the CSS pseudo selector `:fullscreen` for this

* ## &#x1F30B; 5.0 - 2024/06/17

	It's been a while! Micrio 5.0 is released together with the [new Micrio dashboard](https://dash.micr.io/). Read more about this 

	### Links
	* [Blogpost about this release coupled with the release of the new Micrio Dashboard](https://micr.io/blog/20240617-a-new-everything)
	* [JavaScript library](https://r2.micr.io/micrio-5.0.min.js)
	* [TypeScript declarations include](https://r2.micr.io/micrio-5.0.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/5.0/index.html)

	### Key points
	* &#x1F53C; Designed to work with the latest Micrio Dashboard v3 (2024), though still fully backwards compatibly with Micrio 4.x-published images
	* &#x2705; [WCAG 2.2](https://www.w3.org/TR/WCAG22/) accessibility compatibility: full screenreader and keyboard controls support
	* &#x2705;&#x1F53C; Right To Left (rtl) language support
	* &#x2705;&#x1F53C; Markers for 360° object viewing and storytelling
	* &#x2705;&#x1F53C; Single `<micr-io>` ID for 360° objects (Dashboard v3 feature)
	* &#x2705;&#x1F53C; Single `<micr-io>` `album/{folderId]` ID for albums (Dashboard v3 feature)
	* &#x2705; Introduced Grid viewer functionality, `GridController`
	* &#x1F4E2;&#x1F53C; New data model for 5.0 and up: all localizations are in the same model!
	* &#x1F4E2; Interface elements revamp
	* &#x1F9F0; Improved Camera transitions
	* &#x1F9F0; Removed independent Spaces.pub embeddable 360 content compatibility -- Spaces is now fully included in the new Micrio dashboard

	### Data model changes
	* &#x1F4E2; All languages are published in the same file, reducing multilingual complexity
	* &#x1F4E2; Introduced a dynamic `MicrioImage.settings` `Writable`, replacing static `MicrioImage.$info.settings`
	* &#x1F4E2; Renamed namespace `Micrio.Models.ImageCultureData` to `Micrio.Models.ImageData`
	* &#x1F4E2; All localized data sits under `i18n` properties of respective types
	* &#x1F4E2; Positional audio no longer independent entities, and are now an optional Marker setting
	* &#x1F4E2; Marker popups are always statically placed, and can no longer be attached to the marker itself
	* &#x1F4E2; In-image embeds removed from Marker entity and became independent entities
	* &#x1F4E2; Marker custom classNames (`.class` (`string`)) has been changed to `.tags` (`string[]`)

	### JS API changes
	* &#x1F4E2; Each `MicrioImage` has its own individual [`Camera`](https://doc.micr.io/client/api/5.0/classes/Micrio.MicrioImage.html#camera), instead of a single `HTMLMicrioElement.camera` (it still exists, and points to the current active image camera `.$current.camera`)
	* &#x1F4E2; Camera animation functions `.flyTo[...]` have optional [`AnimationOptions`](https://doc.micr.io/client/api/5.0/interfaces/Micrio.Models.Camera.AnimationOptions.html) argument object instead of direct mandatory arguments
	* TypeScript interfaces `Micrio.View` and `Micrio.Coords` have moved to [`Micrio.Models.Camera`](https://doc.micr.io/client/api/5.0/modules/Micrio.Models.Camera.html) namespace

	### User Interface
	* &#x1F4E2; Interface design revamp! HTML is mostly unchanged, but CSS has had a few major improvements
	* &#x2705; Light and dark browser mode support, defaults to `dark`, can be set in the editor
	* &#x2705; Much fancier marker elements
	* &#x2705; You can now also open a marker image gallery as full-window popover
	* &#x1F9F0; All icons use the [Font Awesome icon set](https://fontawesome.com/)
	* &#x1F9F0; Default font used is now [Work Sans](https://fonts.google.com/specimen/Work+Sans)
	* &#x1F9F0; Marker popups are now on the **left** side by default
	* &#x1F9F0; The social sharing button now opens the OS-specific share menu

	### HTML / CSS embedding changes
	* &#x2705; The `<micr-io>` element can now be muted by setting a `muted` attribute, or setting `<micr-io>.muted = true;`
	* &#x1F4E2; All `<micr-io>` attribute options have `data-` prefix, except for `lang`, `id`, `muted`, `height`, `width`, `volume`, `lazyload`.
	* &#x1F4E2; All Micrio HTML component elements now have `micrio-` CSS classname prefix.
	* &#x1F9F0; All `z-index` CSS has been removed: the HTML structure makes sense by itself now.

	### Other changes
	* &#x2705; Added support for video as in-image embeds, including transparent webp/H.265
	* &#x1F9F0; Custom menu pages now have a unique deeplink when `Router` is used

* ## &#x1F4AB; 4.1 - 2022/05/18

	Added more UI customization possibilities

	### Links
	* [JavaScript library](https://b.micr.io/micrio-4.1.min.js)
	* [TypeScript declarations include](https://b.micr.io/micrio-4.1.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/4.1/index.html)

	### Changes
	* Added [UserInterfaceSettings](https://doc.micr.io/client/api/4.1/modules/Micrio.Models.ImageInfo.html#UserInterfaceSettings) where you can specify your own icons
	* You can specify [default image settings](https://doc.micr.io/client/api/4.1/classes/Micrio.HTMLMicrioElement.html#defaultSettings) in JS
	* Extended [MarkerSettings](https://doc.micr.io/client/api/4.1/modules/Micrio.Models.ImageInfo.html#MarkerSettings). You can now:
		* Place marker tour controls inside a marker popup
		* Enable minimizing marker popups
		* Turn on that when a marker is opened that is part of a tour, this tour will also start automatically at the marker's step
	* Added new feature player: Serial Tours
	* Bug and stability fixes


* ## &#x1F495; 4.0 - 2022/02/14

	A total rewrite from the ground up has been done.

	Nothing has been changed in the [data model](https://doc.micr.io/client/api/4.0/modules/Micrio.Models.html), but if you are using custom implementations and want to upgrade, check out
	the [Micrio 4.0 documentation](https://doc.micr.io/client/api/4.0/index.html).

	For __upgrading__ existing 3.x implementations, see [this Micrio knowledge base guide](https://doc.micr.io/client/v4/migrating.html).

	### Links
	* [JavaScript library](https://b.micr.io/micrio-4.0.min.js)
	* [TypeScript declarations include](https://b.micr.io/micrio-4.0.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/4.0/index.html)
	* [Feature examples](https://static.micr.io/docs/client/4.0/examples/index.html)

	### General changes
	* &#x1F9F0; Micrio client codebase is now fully __TypeScript__ (+AssemblyScript for Wasm)
	* &#x1F9F0; New WebAssembly rendering model, improving performance and image switching
	* &#x1F9F0; Switched API documentation pages from [JSDoc](https://jsdoc.app/) to [typedoc](https://typedoc.org/)

	### New features
	* &#x2705; Single `<micr-io>` tag [gallery support](https://static.micr.io/docs/client/4.0/examples/gallery.html)
	* &#x2705; Support for [petapixel resolution](https://static.micr.io/docs/client/4.0/examples/petapixel.html) images
	* &#x2705; Support for [angular photographed spatial objects](https://static.micr.io/docs/client/4.0/examples/angular.html)

	### API
	* &#x2705; Introduced a [State Management](https://doc.micr.io/client/api/4.0/modules/Micrio.State.html) API to replace the deprecated `Micrio.Modules`
	* &#x274C; The `Micrio.Modules` JS API has been deprecated. Please see the migration article above.
	* &#x274C; The `new Micrio()` constructor has been **deprecated**: `<micr-io>` is now the only way to initialize Micrio
	* &#x1F4E2; `Micrio.Camera.setCoo` now requires 3 arguments `(x:number,y:number,z:number)` instead of `int[3]`
	* &#x1F4E2; `<micr-io>` now is the main Micrio controller instance instead of `<micr-io>.micrio`, and has direct Micrio members, such as `.camera`

	### HTML & CSS
	* &#x1F4E2; Micrio interface HTML elements have been restructured and some class names have been changed
	* &#x1F4E2; Micrio marker custom classNames: no more `class-` prefix is added in the output HTML
	* &#x1F4E2; Micrio marker CSS variables changed prefix from `--default-marker-*` to `--micrio-marker-*`

	### Events
	* &#x1F4E2; Events `markerTours-*`, `markerScrollTours-*` and `tours-*` now named `tour-*`


* ## &#x1F4AB; 3.3 - 2021/03/31

	Mainly a stability and performance upgrade.

	### Links
	* [JavaScript library](https://b.micr.io/micrio-3.3.min.js)
	* [TypeScript declarations include](https://b.micr.io/micrio-3.3.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/3.3/index.html)

	### Changes
	* Included Google Tag Manager support for Micrio event tracking
	* You can now use the trackpad for panning and zooming
	* Support for custom JS & CSS uploaded in the Image Editor
	* Set up for use with Spaces
	* Many stability and performance fixes, especially for slower connections


* ## &#x1F4DA; 3.2 - 2021/02

	Fully documented the client using [JSDoc](https://jsdoc.app/) -- See the documentation [here](https://doc.micr.io/client/api/3.2/module-Micrio.html)!

	### Links
	* [JavaScript library](https://b.micr.io/micrio-3.2.min.js)
	* [TypeScript declarations include](https://b.micr.io/micrio-3.2.min.d.ts)
	* [API docs](https://doc.micr.io/client/api/3.2/module-Micrio.html)

	### General
	* &#x1F9F0; Now using [Svelte](https://svelte.dev/) for all interface rendering!
	* &#x2705; __TypeScript__ importable definitions file [micrio-3.2.min.d.ts](https://b.micr.io/micrio-3.2.min.d.ts)

	### DOM structure
	* &#x1F4E2; Due to the change to Svelte, the DOM structure of Micrio HTML elements has been changed
	* &#x1F4E2; Greatly simplified the DOM structure by removing the `ShadowRoot`

	### Performance
	* Using __WebWorkers__ to download tile textures over multiple threads
	* A _lot_ of performance and stability fixes and updates, especially for iPad

* ## &#x1F50E; 3.1 - 2020/11

	### Links
	* [JavaScript library](https://b.micr.io/micrio-3.1.min.js)

	### Changes
	* &#x2705; Added __multi-image__ tours: marker tours over multiple images
	* &#x2705; Added __side-by-side__ comparison mode (let us know if you're interested in this!)
	* Many stability and bug fixes

* ## &#x1F685; 3.0 - 2020/08

	### Links
	* [JavaScript library](https://b.micr.io/micrio-3.0.min.js)

	### Changes
	* &#x1F9F0; Rewrote the entire engine to use __WebAssembly__. Read the journey blogpost [HERE](https://engineering.q42.nl/webassembly/)!</li>
	* Many stability and bug fixes

* ## &#x1F39E; 2.9 - 2020/05

	### Links
	* [JavaScript library](https://b.micr.io/micrio-2.9.min.js)

	### Changes
	* &#x2705; Full 360&deg; video support with enriched content (markers, audio, storytelling)

* ## &#x1F4DC; Earlier versions

	_The dark, pre-changelog days.._

	* 2.8 - 2020/04 - [JS lib](https://b.micr.io/micrio-2.8.min.js)
	* 2.7 - 2020/02 - [JS lib](https://b.micr.io/micrio-2.7.min.js)
	* 2.6 - 2020/01 - [JS lib](https://b.micr.io/micrio-2.6.min.js)
	* 2.5 - 2019/12 - [JS lib](https://b.micr.io/micrio-2.5.min.js)
	* 2.4 - 2019/11 - [JS lib](https://b.micr.io/micrio-2.4.min.js)
	* 2.2 - 2019/08 - [JS lib](https://b.micr.io/micrio-2.2.min.js)
	* 2.0 - 2019/02 - [JS lib](https://b.micr.io/micrio-2.0.min.js)
	* 1.9 - 2019/02 - [JS lib](https://b.micr.io/micrio-1.9.min.js)
	* 1.8 - 2018/07 - [JS lib](https://b.micr.io/micrio-1.8.min.js)
	* 1.7 - 2018/05 - [JS lib](https://b.micr.io/micrio-1.7.min.js)
	* 1.6 - 2018/04 - [JS lib](https://b.micr.io/micrio-1.6.min.js)
	* 1.5 - 2018/04 - [JS lib](https://b.micr.io/micrio-1.5.min.js)
	* 1.4 - 2018/02 - [JS lib](https://b.micr.io/micrio-1.4.min.js)
	* 1.2 - 2017/06 - [JS lib](https://b.micr.io/micrio-1.2.min.js)
	* 0.9 - 2015/06
