import type { Writable } from 'svelte/store';
import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

import { writable } from 'svelte/store';
import { once, View } from './utils';

/**
 * # Micrio State management
 *
 * Manages the application state using Svelte stores, allowing reactive updates
 * throughout the UI and providing methods to get/set the overall state.
 * Replaces the imperative API of Micrio 3.x.
 *
 * Consists of two main state controllers:
 * 1. {@link State.Main}: Global state for the `<micr-io>` element (active tour, marker, UI state).
 * 2. {@link State.Image}: State specific to individual {@link MicrioImage} instances (view, active marker within that image).
 *
 * @see {@link https://doc.micr.io/client/v4/migrating.html | Migrating from Micrio 3.x}
 * @author Marcel Duin <marcel@micr.io>
 */
export namespace State {
	/** Represents the entire serializable state of a Micrio instance. */
	export type MicrioStateJSON = {
		/** The ID of the currently active main image. */
		id: string,
		/** Array containing the state of each individual image canvas. */
		c: ImageState[],
		/** Optional information about the currently active tour [tourId, currentTime?, pausedState?]. */
		t?: [string,number?,string?],
		/** Reference to the currently active HTMLMediaElement (unused?). */
		// TODO: Verify if 'm' property is actually used or needed for state restoration.
		m?: HTMLMediaElement
	}

	/** Represents the serializable state of a single MicrioImage instance. */
	export type ImageState = [
		/** The image ID. */
		string,
		/** The current viewport x0. */
		number,
		/** The current viewport y0. */
		number,
		/** The current viewport x1. */
		number,
		/** The current viewport y1. */
		number,
		/** The ID of the currently opened marker within this image (optional). */
		string?,
		/** The UUID of the media element associated with the opened marker (optional). */
		string?,
		/** The currentTime of the marker's media element (optional). */
		number?,
		/** The paused state ('p') of the marker's media element (optional). */
		string?
	];


	/**
	* # HTMLMicrioElement state controller (`micrio.state`)
	*
	* Manages the global application state associated with the main `<micr-io>` element.
	* Provides Svelte stores for reactive UI updates and methods for state serialization.
	*/
	export class Main {
		/** Writable Svelte store holding the currently active tour object (VideoTour or MarkerTour), or undefined if no tour is active. */
		public readonly tour: Writable<Models.ImageData.VideoTour|Models.ImageData.MarkerTour|undefined> = writable();

		/** Internal reference to the current tour object. @internal */
		private _tour:Models.ImageData.VideoTour|Models.ImageData.MarkerTour|undefined;

		/** Getter for the current value of the {@link tour} store. */
		public get $tour() : Models.ImageData.VideoTour|Models.ImageData.MarkerTour|undefined {return this._tour}

		/** Writable Svelte store holding the marker object currently opened in the *main* active image, or undefined if none is open. */
		public readonly marker: Writable<Models.ImageData.Marker|undefined> = writable();

		/** Writable Svelte store holding the ID of the marker currently being hovered over. */
		public readonly markerHoverId: Writable<string|undefined> = writable();

		/** Internal reference to the currently opened marker object. @internal */
		private _marker: Models.ImageData.Marker|undefined;

		/** Getter for the current value of the {@link marker} store. */
		public get $marker() : Models.ImageData.Marker|undefined { return this._marker }

		/** Writable Svelte store holding the marker object whose popup is currently displayed. */
		public readonly popup: Writable<Models.ImageData.Marker|undefined> = writable<Models.ImageData.Marker>();

		/** Writable Svelte store holding the data for the currently displayed popover (custom page or gallery). See {@link Models.State.PopoverType}. */
		public readonly popover:Writable<Models.State.PopoverType|undefined> = writable();

		/** Stores the last retrieved state JSON object. @internal */
		public value: MicrioStateJSON|undefined;

		/** UI state stores. */
		public ui = {
			/** Writable store controlling the visibility of the main UI controls (bottom right). */
			controls: writable<boolean>(true),
			/** Writable store controlling the visibility of zoom buttons. */
			zoom: writable<boolean>(true),
			/** Writable store controlling the visibility of all UI elements (e.g., for fullscreen or specific modes). */
			hidden: writable<boolean>(false)
		}

		/**
		 * Map storing the playback state (currentTime, paused) of media elements associated with markers, keyed by a unique media ID.
		 * Used to resume media playback when returning to a marker.
		 * @internal
		*/
		mediaState:Map<string,{
			currentTime: number,
			paused: boolean
		}> = new Map();


		/** @internal */
		constructor(private micrio:HTMLMicrioElement){
			// Keep internal properties synced with stores
			this.tour.subscribe(t => { if(typeof t == 'string') return; this._tour = t });
			this.marker.subscribe(m => { if(typeof m == 'string') return; this._marker = m });
		}

		/**
		 * Gets the current state of the Micrio viewer as a serializable JSON object.
		 * This object captures the active image(s), viewports, open markers, active tour,
		 * and media playback states, allowing the exact state to be restored later or elsewhere.
		 *
		 * @example
		 * ```javascript
		 * const currentState = micrio.state.get();
		 * // Store or transmit `currentState`
		 * ```
		 * @returns The current state as a {@link MicrioStateJSON} object, or undefined if no image is loaded.
		 */
		get() : MicrioStateJSON|undefined {
			if(!this.micrio.$current) return; // Cannot get state if no image is loaded
			// Construct the state object
			this.value = {
				id: this.micrio.$current.id, // ID of the main active image
				c: this.micrio.canvases.map(c => c.state.get()) // Get state for each image canvas
			};
			// Add tour state if a tour is active
			if(this._tour) {
				this.value.t = [this._tour.id]; // Store tour ID
				// Store video tour playback state if applicable
				if('instance' in this._tour && this._tour.instance) {
					this.value.t.push(
						this._tour.instance.currentTime,
						this._tour.instance.paused ? 'p' : undefined // Store 'p' if paused
					);
				}
				// TODO: Add state saving for marker tours (currentStep)?
			}
			// TODO: Verify if 'm' property (HTMLMediaElement) is needed/useful here. It's not serializable.
			return this.value;
		}

		/**
		 * Sets the Micrio viewer state from a previously saved {@link MicrioStateJSON} object.
		 * This will attempt to restore the active image, viewports, open markers, active tour,
		 * and media playback states.
		 *
		 * @example
		 * ```javascript
		 * const savedState = // ... load state object ...
		 * micrio.state.set(savedState);
		 * ```
		 * @param s The state object to load.
		 */
		async set(s: MicrioStateJSON) {
			if(!(this.value = s)) return; // Store the state object and exit if null/undefined

			// Restore media playback states first
			if(s.t?.[1] !== undefined) { // If tour state includes time/paused info
				const mediaId = s.t[0]; // Assume tour ID is the media ID for video tours
				const curr = this.mediaState.get(mediaId);
				if(curr) { // Update existing state
					curr.currentTime = s.t[1];
					curr.paused = s.t[2] == 'p';
				} else { // Create new state entry
					this.mediaState.set(mediaId, {currentTime:s.t[1], paused: s.t[2] == 'p'});
				}
			}
			// Restore media state for individual image markers
			s.c?.forEach(imgState => {
				if (imgState[6] !== undefined && imgState[7] !== undefined) { // If media ID and time exist
					const mediaId = imgState[6];
					const curr = this.mediaState.get(mediaId);
					if (curr) {
						curr.currentTime = imgState[7];
						curr.paused = imgState[8] == 'p';
					} else {
						this.mediaState.set(mediaId, { currentTime: imgState[7], paused: imgState[8] == 'p' });
					}
				}
			});


			// Set active tour if specified in state
			if(s.t) {
				await this.setTour(s.t[0]); // Wait for tour to be potentially set
			}

			// Open the main image specified in the state if it's not already current
			if(this.micrio.$current?.id != s.id) {
				this.micrio.open(s.id);
				// Wait for the image to potentially load its data before setting individual states
				if (this.micrio.$current) { // Add check for current image existence
					await once(this.micrio.$current.data, { allowUndefined: true });
				}
			}

			// Set state for each individual image canvas
			this.micrio.canvases.forEach(imgInstance => {
				imgInstance.state.set(s.c.find(c => c[0] == imgInstance.id));
			});

			// Re-check tour state after potentially opening a new image
			if(s.t) {
				// If tour was set, the marker should be handled by tour logic/marker subscription
				return this.setTour(s.t[0]);
			} else {
				// If no tour, fly to the saved view of the main image (if no marker was opened by state.set)
				const mainImgState = s.c.find(i => i[0] == s.id);
				if(mainImgState && !mainImgState[5] && this.micrio.$current) { // Check if marker ID (index 5) is absent
					this.micrio.$current.camera.flyToView(View.fromRaw(mainImgState.slice(1,5) as Models.Camera.ViewRect)!, {speed:2}).catch(() => {});
				}
			}
		}

		/**
		 * Finds and sets the active tour based on its ID.
		 * Waits for the current image data to be available.
		 * @internal
		 * @param id The ID of the tour to activate.
		 */
		private async setTour(id:string) {
			if(!this.micrio.$current || this._tour?.id == id) return; // Exit if no current image or tour already active
			// Wait for image data to load (needed to find the tour object)
			const data = await once(this.micrio.$current.data, {allowUndefined: true});
			if(data) {
				// Find tour in markerTours or tours array and set the store
				this.tour.set(data.markerTours?.find(t => t.id == id) || data.tours?.find(t => t.id == id));
			}
		}
	}

	/**
	* # MicrioImage state controller (`micrioImage.state`)
	*
	* Manages the state specific to a single {@link MicrioImage} instance,
	* primarily its viewport and currently opened marker.
	*/
	export class Image {
		/** Writable Svelte store holding the current viewport [centerX, centerY, width, height] of this image. */
		public readonly view: Writable<Models.Camera.View|undefined> = writable(undefined);
		/** Internal reference to the current view. @internal */
		private _view:Models.Camera.View|undefined;
		/** Getter for the current value of the {@link view} store. */
		public get $view() : Models.Camera.View|undefined {return this._view}

		/**
		 * Writable Svelte store holding the currently active marker within *this specific image*.
		 * Can be set with a marker ID string or a full marker object. Setting to undefined closes the marker.
		 */
		public readonly marker: Writable<Models.ImageData.Marker|string|undefined> = writable(undefined);
		/** Internal reference to the active marker object. @internal */
		private _marker:Models.ImageData.Marker|undefined;
		/** Getter for the current value of the {@link marker} store. */
		public get $marker() : Models.ImageData.Marker|undefined {return this._marker}

		/** Writable Svelte store holding the currently displayed layer index (for Omni objects). */
		public readonly layer: Writable<number> = writable(0);

		/** @internal */
		constructor(private image:MicrioImage){
			const m = image.wasm.micrio; // Reference to main element
			let pV:string, pW:number, pH:number; // Previous view state for change detection

			// Subscribe to view store changes
			this.view.subscribe(view => {
				this._view = view; // Update internal reference
				const nV = view?.toString(); // Stringify for simple comparison
				if(view && nV && pV != nV) { // If view changed
					const detail = {image, view}; // Event detail payload with view360
					pV = nV;
					const nW = view.width, nH = view.height; // Calculate new width/height
					// Dispatch 'zoom' event if dimensions changed significantly
					if(!pW || !pH || Math.abs((nW-pW)+(nH-pH)) > 1E-5) {
						m.events.dispatch('zoom', detail)
						pW=nW,pH=nH; // Update previous dimensions
					}
					// Dispatch 'move' event
					m.events.dispatch('move', detail);
				}
			});

			// Subscribe to local marker store changes
			this.marker.subscribe(marker => {
				const curr = this._marker; // Store previous marker
				// Update internal marker reference (only store the object, not the ID string)
				this._marker = (marker && typeof marker != 'string' ? marker : undefined);
				// If this marker change resulted in a new marker object being set,
				// update the global marker state as well.
				if(this._marker) {
					m.state.marker.set(this._marker);
				}
				// If the marker was cleared locally AND it was the globally active marker,
				// clear the global marker state too.
				else if(!marker && m.state.$marker == curr) {
					m.state.marker.set(undefined);
				}
			});
		}

		/** Hooks up the layer store subscription for Omni objects. @internal */
		hookOmni() : void {
			const image = this.image;
			this.layer.subscribe(l => {
				if(image.ptr < 0 || !image.wasm.e) return; // Ensure Wasm is ready
				image.wasm.setActiveLayer(image.ptr, l); // Call Wasm function
				image.wasm.render(); // Trigger render
			});
		}

		/**
		 * Gets the current state of this specific image instance as a serializable array.
		 * @internal
		 * @returns The image state as an {@link ImageState} array.
		*/
		get() : ImageState {
			const m = this._marker; // Use the internal marker object reference
			// Find associated media state if a marker is open
			const media = m ? Array.from(this.image.wasm.micrio.state.mediaState).reverse().find(x => x[0].startsWith(m.id)) : null;
			// Construct the state array
			return [
				this.image.id,
				...(View.toRaw(this._view) ?? [0.5,0.5,1,1]), // Use current view or default
				...(m ? [m.id, ...(media ? [media[0], media[1].currentTime, media[1].paused ? 'p' : undefined] : [])] : [undefined]) // Add marker ID and media state if present
			].filter(v => v !== undefined) as ImageState; // Filter out undefined values
		}

		/**
		 * Sets the state of this image instance from a serialized state array.
		 * @internal
		 * @param o The {@link ImageState} array.
		*/
		set(o?: ImageState) {
			if(!o?.length) return; // Exit if no state provided
			// Set the view store (this will trigger updates)
			// TODO: Should this flyToView instead of setting directly? Setting directly might cause jumps.
			this.view.set(View.fromRaw(o as Models.Camera.ViewRect));
			// Set the marker store if a marker ID is present in the state
			if(o[5]) {
				// Only set if different from current marker to avoid loops
				if(this._marker?.id != o[5]) this.marker.set(o[5]);

				// Restore media state if present (media ID at index 6, time at 7, paused at 8)
				// Note: This relies on mediaState being populated *before* this set method is called,
				// which happens in State.Main.set.
				// if(o[6]) {
				// 	const state = this.image.wasm.micrio.state.mediaState;
				// 	const curr = state.get(o[6]);
				// 	if(o[7] !== undefined) { // Check if time exists
				// 		if(curr) { curr.currentTime = o[7]; curr.paused = o[8] == 'p'; }
				// 		else state.set(o[6], { currentTime: o[7], paused: o[8] == 'p' })
				// 	}
				// }
			} else {
				// If no marker ID in state, ensure local marker store is cleared
				if (this._marker) this.marker.set(undefined);
			}
		}
	}

}
