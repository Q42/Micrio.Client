/**
 * # Store API in Micrio
 *
 * Micrio uses a custom store implementation (`$core/store`) for its internal state management.
 * The API is compatible with stores (writable, readable, get, subscribe).
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
 * An example of setting and subscribing to the {@link MicrioImage.data} writable store:
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
 *
 * | Property   | Direct value getter | Type | Description |
 * | ----------- | ----------- | ------------- | ---- |
 * | **`<micr-io>` Element** |||
 * | .{@link HTMLMicrioElement.current} | {@link HTMLMicrioElement.$current} | {@link Writable}&lt;{@link MicrioImage}&gt; | The current active and shown {@link MicrioImage} |
 * | **`<micr-io>.state` controller** |||
 * | .{@link State.Main.tour} | {@link State.Main.$tour} | {@link Writable}&lt;{@link Models.ImageData.MarkerTour} &#124; {@link Models.ImageData.VideoTour}&gt; | The current running VideoTour or MarkerTour |
 * | .{@link State.Main.marker} | {@link State.Main.$marker} | {@link Writable}&lt;{@link Models.ImageData.Marker}&gt; | The current opened marker in the current opened {@link MicrioImage} |
 * **Individual `MicrioImage`** |||
 * | .{@link MicrioImage.info} | {@link MicrioImage.$info} | {@link Readable}&lt;{@link Models.ImageInfo}&gt; | The static image base info |
 * | .{@link MicrioImage.data} | {@link MicrioImage.$data} | {@link Writable}&lt;{@link Models.ImageData}&gt; | The image data (markers, tours, etc) |
 * **`MicrioImage.state` controller** |||
 * | .{@link State.Image.view} | {@link State.Image.$view} | {@link Writable}&lt;{@link Models.Camera.View}&gt; | The current viewport |
 * | .{@link State.Main.marker} | {@link State.Main.$marker} | {@link Writable}&lt;{@link Models.ImageData.Marker}&gt; | The current opened marker of this image |
 *
 *
 */

/** Callback type for receiving store value updates. */
type Subscriber<T> = (value: T) => void;
/** Cleanup function returned by store subscription methods. */
type Unsubscriber = () => void;
/** Transformer function used with Writable.update(). */
type Updater<T> = (value: T) => T;

/** A read-only store that emits value changes to subscribers. */
export interface Readable<T> {
	subscribe(this: void, run: Subscriber<T>, invalidate?: (value?: T) => void): Unsubscriber;
}

/** A writable store that supports setting and updating its value. */
export interface Writable<T> extends Readable<T> {
	set(value: T): void;
	update(fn: Updater<T>): void;
}

/** Creates a writable store with an optional initial value. @internal */
export function writable<T>(value?: T): Writable<T> {
	const subs = new Set<Subscriber<T>>();

	return {
		subscribe(run: Subscriber<T>, _invalidate?: (value?: T) => void): Unsubscriber {
			subs.add(run);
			run(value as T);
			return () => subs.delete(run);
		},
		set(v: T) {
			value = v;
			subs.forEach(fn => fn(v));
		},
		update(fn: Updater<T>) {
			this.set(fn(value as T));
		}
	};
}

/** Synchronously reads the current value of a store by subscribing and immediately unsubscribing. */
export function get<T>(store: { subscribe(fn: Subscriber<T>): Unsubscriber }): T {
	let v: T | undefined;
	const unsub = store.subscribe(val => { v = val; });
	unsub();
	return v as T;
}

/** Returns a resolved promise, used to defer execution until the next microtask. @internal */
export function tick(): Promise<void> {
	return Promise.resolve();
}

/** Wraps a subscriber so rapid successive calls coalesce into one via microtask @internal */
export function defer<T>(fn: Subscriber<T>): Subscriber<T> {
	let pending = false;
	let last: T;
	return (v: T) => {
		last = v;
		if (pending) return;
		pending = true;
		Promise.resolve().then(() => {
			pending = false;
			fn(last);
		});
	};
}

/** Wraps a subscriber to skip the very first emission (for onMount where initial state is handled manually) @internal */
export function skipFirst<T>(fn: Subscriber<T>): Subscriber<T> {
	let first = true;
	return (v: T) => {
		if (first) { first = false; return; }
		fn(v);
	};
}

/** Combines skipFirst + defer: skip initial emission, then coalesce rapid subsequent calls @internal */
export function lazy<T>(fn: Subscriber<T>): Subscriber<T> {
	return defer(skipFirst(fn));
}

export type { Subscriber, Unsubscriber, Updater };
