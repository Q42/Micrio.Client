/**
 * # Svelte stores in Micrio
 * 
 * Micrio uses [Svelte Stores](https://svelte.dev/tutorial/writable-stores) for its internal state management.
 * 
 * This means that changes in values can passively trigger state updates.
 * 
 * There are two types of stores: {@link Readable}, which is read-only for the user, and {@link Writable} which can be updated or overridden by the user.
 * 
 * Typically, for accessing the data directly instead of its store, Micrio offers `$` prefixes to any store properties:
 * 
 * ```js
 * // This is the current active image in <micr-io> (.current is the store Writable)
 * const image = micrio.$current;
 * 
 * // The current image ImageInfo value
 * const info = image.$info;
 * 
 * // Log the current image resolution
 * console.log(`The current image is ${info.width} x ${info.height}px`);
 * 
 * // The current CultureData value of the current MicrioImage
 * console.log(micrio.$current.$data);
 * ```
 * 
 * An example of setting and subscribing to the {@link Micrio.MicrioImage.data} writable store:
 * 
 * ```js
 * 
 * // Subscribe to any changes in its data (markers, tours, etc)
 * image.data.subscribe(data => {
 * 	// Data for this image been set, removed or changed
 * 	// This also triggers when the image data has been loaded from the server
 * 	if(data) console.log(`The image now has ${data.markers.length} markers`);
 * 	else console.log('The image data is now empty.');
 * });
 * 
 * // Let's set the image data to something. It expects ImageData.
 * image.data.set({
 * 	markers: [{
 * 		"title": "My First Marker",
 * 		"x": .5,
 * 		"y": .5
 * 	}]
 * });
 * 
 * // Immediately access the data
 * console.log('The data has been set to', image.$data);
 * ```
 * 
 * ## List of stores used by Micrio:

 * | Property   | Direct value getter | Type | Description |
 * | ----------- | ----------- | ------------- | ---- |
 * | **`<micr-io>` Element** |||
 * | .{@link Micrio.HTMLMicrioElement.current} | {@link Micrio.HTMLMicrioElement.$current} | {@link Writable}&lt;{@link Micrio.MicrioImage}&gt; | The current active and shown {@link Micrio.MicrioImage} |
 * | **`<micr-io>.state` controller** |||
 * | .{@link Micrio.State.Main.tour} | {@link Micrio.State.Main.$tour} | {@link Writable}&lt;{@link Micrio.Models.ImageData.MarkerTour} &#124; {@link Micrio.Models.ImageData.VideoTour}&gt; | The current running VideoTour or MarkerTour |
 * | .{@link Micrio.State.Main.marker} | {@link Micrio.State.Main.$marker} | {@link Writable}&lt;{@link Micrio.Models.ImageData.Marker}&gt; | The current opened marker in the current opened {@link Micrio.MicrioImage} |
 * **Individual `MicrioImage`** |||
 * | .{@link Micrio.MicrioImage.info} | {@link Micrio.MicrioImage.$info} | {@link Readable}&lt;{@link Micrio.Models.ImageInfo}&gt; | The static image base info |
 * | .{@link Micrio.MicrioImage.data} | {@link Micrio.MicrioImage.$data} | {@link Writable}&lt;{@link Micrio.Models.ImageData}&gt; | The image data (markers, tours, etc) |
 * **`MicrioImage.state` controller** |||
 * | .{@link Micrio.State.Image.view} | {@link Micrio.State.Image.$view} | {@link Writable}&lt;{@link Micrio.Models.Camera.View}&gt; | The current viewport |
 * | .{@link Micrio.State.Main.marker} | {@link Micrio.State.Main.$marker} | {@link Writable}&lt;{@link Micrio.Models.ImageData.Marker}&gt; | The current opened marker of this image |
 *
 *
 * @category Svelte
 * @module SvelteStore
 * @author [These people](https://github.com/sveltejs/svelte/graphs/contributors)
 * @license MIT https://github.com/sveltejs/svelte/blob/master/LICENSE.md
*/

export * from 'svelte/store';
