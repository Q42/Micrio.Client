/**
 * # The Micrio client API
 *
 * ## Using Micrio inside your own website
 *
 * You can fully implement Micrio in your website in just 2 steps:
 *
 * 1. Include the Micrio JS script tag in your HTML `<head>`:
 *
 * 		<script src="https://r2.micr.io/micrio-5.1.min.js" defer></script>
 *
 * 2. Use the special Micrio `<micr-io>` HTML tag inside your document:
 *
 * 		<micr-io id="\{your image ID\}"></micr-io>
 *
 * This will place the image element and will auto-load all required data and any markers and tours you have created in the [Micrio Dashboard](https://dash.micr.io/).
 *
 * You can style and place this element using basic CSS.
 *
 * For any custom behavior, you can use this client API.
 *
 * ## A simple example
 *
 * ```html
 * <micr-io id="dzzLm" data-ui="false"></micr-io>
 * ```
 *
 * yields in a zoomable Micrio image without any HTML controls:
 *
 * <script src="https://r2.micr.io/micrio-5.1.min.js"></script>
 * <micr-io id="dzzLm" style="height:500px" data-ui="false"></micr-io>
 *
 * To access this Micrio instance using JS, you can simply query the HTML element:
 *
 * ```js
 * const micrio = document.querySelector('micr-io');
 * ```
 *
 * This yields a {@link HTMLMicrioElement} element, which can be immediately accessed.
 *
 * For instance, to animate the camera to a certain viewport, let's add this button:
 *
 * ```html
 * <button onclick="() => micrio.camera.flyToView([.25,.25,.30,.30])">Animate the camera</button>
 * ```
 *
 * <button onclick="document.querySelector('micr-io').camera.flyToView([.25,.25,.30,.30])">Animate the camera</button>
 *
 * ## Using the API inside your own application
 *
 * Using Javascript, you can simply follow this documentation and examples when creating any custom behavior with Micrio.
 *
 * If you use TypeScript in your project, you can use the **Micrio Declarations file** [micrio-5.1.min.d.ts](https://b.micr.io/micrio-5.1.min.d.ts)!
 *
 * Simply include the `d.ts` file in your project in a directory included in your project, and implement it:
 *
 * ```ts
 * import type { HTMLMicrioElement } from 'Micrio';
 *
 * // This gives you full type checking and any editor autocompletion
 * const micrio = document.querySelector('micr-io') as HTMLMicrioElement;
 *
 * // VS Code will fully know what you're doing here
 * micrio.camera.flyToView([.2,.2,.3,.3]).then(() => console.log('done!'));
 * ```
 *
 * @category Micrio
 * @module Micrio
 * @author Marcel Duin <marcel@micr.io>
 *
*/

/** @internal */
export * from '../ts/enums';
/** @internal */
export * from '../ts/element';
/** @internal */
export * from '../ts/wasm';
/** @internal */
export * from '../ts/canvas';
/** @internal */
export * from '../ts/events';
/** @internal */
export * from '../ts/image';
/** @internal */
export * from '../ts/camera';
/** @internal */
export * from '../ts/state';
/** @internal */
export * from '../ts/grid';
/** @internal */
export * from '../ts/swiper';
/** @internal */
export * from '../ts/videotour';
/** @internal */
export * from '../types/models';
