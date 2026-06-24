import type { Writable } from 'svelte/store';
import type { Models } from '$types/models';
import type { MicrioImage } from './image';

import { writable } from 'svelte/store';

/**
 * # Micrio State management
 *
 * Manages the application state using Svelte stores, allowing reactive updates
 * throughout the UI.
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

	/**
	* # HTMLMicrioElement state controller (`micrio.state`)
	*
	* Manages the global application state associated with the main `<micr-io>` element.
	* Provides Svelte stores for reactive UI updates.
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

		/** UI state stores. */
		public ui = {
			/** Writable store controlling the visibility of the main UI controls (bottom right). */
			controls: writable<boolean>(true),
			/** Writable store controlling the visibility of zoom buttons. */
			zoom: writable<boolean>(true),
			/** Writable store controlling the visibility of all UI elements (e.g., for fullscreen or specific modes). */
			hidden: writable<boolean>(false),
			/** Writable store: true when gallery controls are hovered or focused, keeping all UI visible. */
			hover: writable<boolean>(false)
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
		constructor(){
			// Keep internal properties synced with stores
			this.tour.subscribe(t => { if(typeof t == 'string') return; this._tour = t });
			this.marker.subscribe(m => { if(typeof m == 'string') return; this._marker = m });
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
			const m = image.engine.micrio; // Reference to main element
			let pV:string, pW:number, pH:number; // Previous view state for change detection

			// Subscribe to view store changes
			this.view.subscribe(view => {
				this._view = view; // Update internal reference
				const nV = view?.toString(); // Stringify for simple comparison
				if(view && nV && pV != nV) { // If view changed
					const detail = {image, view}; // Event detail payload with view360
					pV = nV;
					const nW = view[2], nH = view[3]; // Calculate new width/height
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
				if(image.ptr < 0 || !image.engine.ready) return;
				image.engine.setActiveLayer(image.ptr, l); // Call engine
				image.engine.render(); // Trigger render
			});
		}
	}

}
