import type { Writable } from 'svelte/store';
import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

import { writable } from 'svelte/store';
import { once } from './utils';

/**
 * # Micrio State management
 *
 * Newly introduced in Micrio 4.0 is the replacement of the way you can interact with markers and tours from a classic imperative JavaScript API to a Svelte-inspired, store-based **state** management using {@link SvelteStore}.
 *
 * This has greatly simplified the internal workings and has made the HTML interface fully reactive based on the image state instead of being interwoven in the previous JS API itself.
 *
 * There are 2 `State` controllers:
 *
 * 1. {@link State.Main}: the main {@link HTMLMicrioElement} state controller, used for:
 * 	* Getting and setting the active tour and marker
 * 	* Loading and saving the entire current state as a minimal independent JSON object
 * 2. {@link State.Image}: individual image {@link MicrioImage.state} controller, used for:
 * 	* Setting the current opened marker in this image
 * 	* Getting the image's last known viewport, even if it is not active at the moment
 *
 * ## Upgrading from Micrio 3.x to 4.x
 *
 * Please refer to [this Micrio knowledge base article](https://doc.micr.io/client/v4/migrating.html)
 * for if you want to upgrade an existing 3.x implementation to 4.x.
 *
 * @author Marcel Duin <marcel@micr.io>
*/
export namespace State {
	/** A main Micrio state JSON object */
	export type MicrioStateJSON = {
		/** The current image id */
		id: string,
		/** Array of individual image states */
		c: ImageState[],
		/** Any running tour */
		t?: [string,number?,string?],
		/** Any running media */
		m?: HTMLMediaElement
	}

	/** An individual image state */
	export type ImageState = [
		// The image id
		string,
		// The current viewport
		number, number, number, number,
		// The marker id
		string?,
		// The marker media ID
		string?,
		// The media current time
		number?,
		// The media paused state
		string?
	];


	/**
	* # HTMLMicrioElement state controller
	*
	* The {@link State.Main} constructor is used as {@link HTMLMicrioElement.state}, and offers:
	*
	* * Reading and setting the active tour and marker
	* * Loading and saving the entire current state as a minimal independent JSON object
	*
	*/
	export class Main {
		/** The current {@link Models.ImageData.MarkerTour} or {@link Models.ImageData.VideoTour} store {@link SvelteStore.Writable} */
		public readonly tour: Writable<Models.ImageData.VideoTour|Models.ImageData.MarkerTour|undefined> = writable();

		/** @internal */
		private _tour:Models.ImageData.VideoTour|Models.ImageData.MarkerTour|undefined;

		/** The current active {@link Models.ImageData.MarkerTour} or {@link Models.ImageData.VideoTour} */
		public get $tour() : Models.ImageData.VideoTour|Models.ImageData.MarkerTour|undefined {return this._tour}

		/** The current shown image's opened {@link Models.ImageData.Marker} store {@link SvelteStore.Writable} */
		public readonly marker: Writable<Models.ImageData.Marker|undefined> = writable();

		/** The current hovered marker */
		public readonly markerHoverId: Writable<string|undefined> = writable();

		/** @internal */
		private _marker: Models.ImageData.Marker|undefined;

		/** The current opened {@link Models.ImageData.Marker} of the current shown {@link MicrioImage} */
		public get $marker() : Models.ImageData.Marker|undefined { return this._marker }

		/** The current opened popup */
		public readonly popup: Writable<Models.ImageData.Marker|undefined> = writable<Models.ImageData.Marker>();

		/** The current opened custom content page */
		public readonly popover:Writable<Models.State.PopoverType|undefined> = writable();

		/** @internal */
		public value: MicrioStateJSON|undefined;

		/** UI controls settings */
		public ui = {
			/** Show/hide main controls */
			controls: writable<boolean>(true),
			/** Show zoom buttons if applicable */
			zoom: writable<boolean>(true),
			/** Hide all UI elements */
			hidden: writable<boolean>(false)
		}

		/** Stores the media state of marker media
		 * @internal
		*/
		mediaState:Map<string,{
			/** The current time */
			currentTime: number,
			/** Paused or not */
			paused: boolean
		}> = new Map();


		/** @internal */
		constructor(private micrio:HTMLMicrioElement){
			this.tour.subscribe(t => { if(typeof t == 'string') return; this._tour = t });
			this.marker.subscribe(m => { if(typeof m == 'string') return; this._marker = m });
		}

		/**
		 * Gets the current state as an independent, minimal JSON object.
		 * This includes the currently open image(s), marker(s), and actively playing media (video, audio, tour) and its state.
		 * You can use this object in any other environment to immediately replicate this state (neat!).
		 *
		 * Example:
		 *
		 * ```js
		 * // Save the current state in Browser 1
		 * const state = micrio.state.get();
		 *
		 * // Save or sync this object to Browser 2 and load it there..
		 *
		 * // This makes the <micr-io> session state identical to Browser 1.
		 * micrio.state.set(state);
		 * ```
		 */
		get() : MicrioStateJSON|undefined {
			if(!this.micrio.$current) return;
			this.value = {
				id: this.micrio.$current.id,
				c: this.micrio.canvases.map(c => c.state.get())
			};
			if(this._tour) {
				this.value.t = [this._tour.id];
				if('instance' in this._tour && this._tour.instance) this.value.t.push(
					this._tour.instance.currentTime,
					this._tour.instance.paused ? 'p' : undefined);
			}
			return this.value;
		}

		/**
		 * Sets the state from a `MicrioStateJSON` object, output by the function above here.
		 * This works on any Micrio instance!
		*/
		async set(s: MicrioStateJSON) {
			if(!(this.value = s)) return;
			// Check for marker tour in current image
			if(s.t) {
				const curr = this.mediaState.get(s.t[0]);
				if(s.t[1]) {
					if(curr) { curr.currentTime = s.t[1]; curr.paused = s.t[2] == 'p' }
					else this.mediaState.set(s.t[0],{currentTime:s.t[1], paused: s.t[2] == 'p'});
				}
				await this.setTour(s.t[0]);
			}
			// Set all individual image marker states
			this.micrio.canvases.forEach(i => i.state.set(s.c.find(c=>c[0]==i.id)));
			if(this.micrio.$current?.id != s.id) this.micrio.open(s.id);
			// Check again
			if(s.t) return this.setTour(s.t[0]);
			else {
				const curr = s.c.find(i => i[0] == s.id);
				if(curr && !curr[5]) this.micrio.$current?.camera.flyToView(curr.slice(1,5) as number[], {speed:2}).catch(() => {});
			}
		}

		private async setTour(id:string) {
			if(!this.micrio.$current || this._tour?.id == id) return;
			const data = await once(this.micrio.$current.data, {allowUndefined: true});
			if(data) this.tour.set(data.markerTours?.find(t => t.id == id) || data.tours?.find(t => t.id == id));
		}
	}

	/**
	* # MicrioImage state controller
	*
	* The {@link State.Image} constructor is used as {@link MicrioImage.state}, and offers:
	*
	* * Setting the current opened marker in this image
	* * Getting the image's last known viewport, even if it is not active at the moment
	*/
	export class Image {
		/** The current image viewport store {@link SvelteStore.Writable} */
		public readonly view: Writable<Models.Camera.View|undefined> = writable(undefined);
		/** @internal */
		private _view:Models.Camera.View|undefined;
		/** The current or last known viewport of this image */
		public get $view() : Models.Camera.View|undefined {return this._view}
	
		/**
		 * The current active marker store {@link SvelteStore.Writable}.
		 * You can either set this to be a {@link Models.ImageData.Marker} JSON object, or `string`, which is the ID
		 * of the marker you wish to open.
		 */
		public readonly marker: Writable<Models.ImageData.Marker|string|undefined> = writable(undefined);
		/** @internal */
		private _marker:Models.ImageData.Marker|undefined;
		/** The current active Marker instance */
		public get $marker() : Models.ImageData.Marker|undefined {return this._marker}

		/** The current layer to display (omni objects) */
		public readonly layer: Writable<number> = writable(0);

		/** @internal */
		constructor(private image:MicrioImage){
			const m = image.wasm.micrio;
			let pV:string, pW:number, pH:number;

			// The view gets updated directly from Wasm
			this.view.subscribe(view => { 
				const nV = view?.toString();
				const detail = {image, view};
				if(view && nV && pV != nV) {
					pV = nV;
					const nW = view[2]-view[0], nH = view[3]-view[1];
					if(!pW || !pH || Math.abs((nW-pW)+(nH-pH)) > 1E-5) {
						m.events.dispatch('zoom', detail)
						pW=nW,pH=nH;
					}
					m.events.dispatch('move', detail);
					if(!this._view) this._view = view;
				}
			});
			this.marker.subscribe(marker => {
				const curr = this._marker;
				if(this._marker = (marker && typeof marker != 'string' ? marker : undefined))
					m.state.marker.set(this._marker);
				else if(!marker && m.state.$marker == curr)
					m.state.marker.set(undefined);
			});
		}

		/** Hook omni layer */
		hookOmni() : void {
			const image = this.image;
			this.layer.subscribe(l => {
				if(image.ptr < 0 || !image.wasm.e) return;
				image.wasm.setActiveLayer(image.ptr, l);
				image.wasm.render();
			});
		}
	
		/** Gets the current state as an independent, minimal JSON object.
		 * @internal
		*/
		get() : ImageState {
			const m = typeof this._marker != 'string' && this._marker;
			const media = m ? Array.from(this.image.wasm.micrio.state.mediaState).reverse().find(x => x[0].startsWith(m.id)) : null;
			return [
				this.image.id,
				...[].slice.call(this._view),
				...(m ? [m.id, ...(media ? [media[0], media[1].currentTime, media[1].paused ? 'p' : undefined] : [])] : [this._marker])
			].filter(v => v !== undefined) as ImageState;
		}
	
		/** Sets the state from JSON object
		 * @internal
		*/
		set(o?: ImageState) {
			if(!o?.length) return;
			this.view.set([o[1],o[2],o[3],o[4]]);
			if(o[5]) {
				if(this._marker?.id != o[5]) this.marker.set(o[5]);
				if(o[6]) {
					const state = this.image.wasm.micrio.state.mediaState;
					const curr = state.get(o[6]);
					if(o[7]) {
						if(curr) { curr.currentTime = o[7]; curr.paused = o[8] == 'p'; }
						else state.set(o[6], { currentTime: o[7], paused: o[8] == 'p' })
					}
				}
			}
		}
	}

}
