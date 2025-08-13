/**
 * Micrio grid display controller
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';

import { MicrioImage } from './image';
import { get, writable, type Unsubscriber, type Writable } from 'svelte/store';
import { deepCopy, once, sleep, View } from './utils';
import { tick } from 'svelte';
import { Enums } from '../ts/enums';

/** Rounds a number to 5 decimal places. @internal */
const round = (n:number) => Math.round(n*100000)/100000;

/**
 * Controls the display and interaction logic for grid layouts.
 * Instantiated on the primary {@link MicrioImage} if grid data is present.
 * Accessed via `micrioImage.grid`.
 */
export class Grid {
	/**
	 * Converts an ImageInfo object and options into the grid string format.
	 * Format: `id,width,height,type?,format?,view?,area?,focus?,cultures?|sizeX,sizeY?`
	 * @internal
	 * @param i The ImageInfo object.
	 * @param opts Options including view, area, size, and cultures.
	 * @returns The formatted grid string for this image.
	 */
	static getString = (i:Models.ImageInfo.ImageInfo, opts: {
		view?:Models.Camera.View360;
		area?:Models.Camera.ViewRect;
		size?:number[];
		cultures?: string;
	}) : string => [
		i.id,
		i.width,
		i.height,
		i.isDeepZoom ? 'd' : '', // 'd' for DeepZoom
		i.isPng ? 'p':i.isWebP ? 'w' : '', // 'p' for PNG, 'w' for WebP
		View.toRaw(opts.view)?.map(round).join('/'), // View: cX,cY,w,h
		opts.area?.map(round).join('/'), // Area: x0/y0/x1/y1
		i.settings?.focus?.map(round).join('-'), // Focus: x-y
		opts.cultures // Comma-separated cultures
	].join(',').replace(/,+$/,'')+(opts.size? `|${opts.size.join(',')}`:''); // Append size if present: |w,h

	/** Array of {@link MicrioImage} instances currently part of the grid definition (loaded). */
	readonly images:MicrioImage[] = [];

	/** Array of {@link MicrioImage} instances currently visible in the grid layout. */
	current:MicrioImage[] = [];

	/** The main HTML `<div>` element used to render the CSS grid layout for the clickable overlay. @internal */
	_grid = document.createElement('div');

	/** Map storing references to the HTML `<button>` elements representing each grid item in the overlay. Keyed by image ID. @internal */
	_buttons:Map<string, HTMLButtonElement> = new Map();

	/** If true, the HTML grid overlay remains visible and interactive even when an image is focused. */
	clickable:boolean = false;

	/** Writable Svelte store holding the currently focused {@link MicrioImage} instance, or undefined if in grid view. */
	readonly focussed:Writable<MicrioImage|undefined> = writable();

	/** Getter for the current value of the {@link focussed} store. */
	get $focussed() : MicrioImage|undefined { return get(this.focussed); }

	/** Writable Svelte store holding an array of {@link MicrioImage} instances whose markers should be displayed in the grid view. */
	readonly markersShown:Writable<MicrioImage[]> = writable([]);

	/** Array storing the history of grid layouts for back navigation. */
	history:Models.Grid.GridHistory[] = [];

	/** Writable Svelte store indicating the current depth in the grid history stack. */
	public depth:Writable<number> = writable<number>(0);

	/** Default animation duration (seconds) when transitioning *into* a new layout or focused view. */
	aniDurationIn:number = 1.5;

	/** Default animation duration (seconds) when transitioning *out* of a focused view or going back in history. */
	aniDurationOut:number = 0.5;

	/** Delay (seconds) between individual image transitions for 'delayed' effects. */
	transitionDelay:number = .5;

	/** Stores a specific crossfade duration for the *next* transition only. @internal */
	private nextCrossFadeDuration:number|undefined;

	/** Flag indicating if the current grid layout is a single horizontal row. @internal */
	private isHorizontal:boolean = false;

	/** Map storing the current cell size [widthSpan, heightSpan?] for each image ID in the grid. @internal */
	readonly cellSizes:Map<string, [number,number?]> = new Map();

	/** Temporary map storing cell sizes for the *next* layout transition, often set by marker actions. @internal */
	private readonly nextSize:Map<string, [number,number?]> = new Map();

	/** Stores the name and data of the last custom grid action executed to prevent duplicates. @internal */
	private lastAction:string|undefined;

	/** Unsubscriber function for the main image view subscription used by the HTML grid overlay. @internal */
	private viewUnsub:Unsubscriber|undefined;

	/** Timeout ID for debouncing grid updates or transitions. @internal */
	private _to:any
	/** Timeout ID specifically for fade-in animations during transitions. @internal */
	private _fadeTo:any
	/** Default animation timing function for grid transitions. @internal */
	private timingFunction:Models.Camera.TimingFunction = 'ease';

	/** Stores the Promise returned by the last `set()` call. @internal */
	lastPromise:Promise<MicrioImage[]>|undefined;

	/**
	 * The Grid constructor. Initializes the grid based on image settings.
	 * @param micrio The main HTMLMicrioElement instance.
	 * @param image The MicrioImage instance acting as the virtual container for the grid.
	*/
	constructor(
		public micrio:HTMLMicrioElement,
		public image:MicrioImage
	) {
		// Bind event handlers
		this.tourEvent = this.tourEvent.bind(this);
		this.updateGrid = this.updateGrid.bind(this);

		// Apply settings from the container image
		const s = image.$settings;
		this.clickable = !!s.gridClickable;
		if(s.gridTransitionDuration !== undefined) this.aniDurationIn = this.aniDurationOut = s.gridTransitionDuration;
		if(s.gridTransitionDurationOut !== undefined) this.aniDurationOut = s.gridTransitionDurationOut;

		// Initialize the HTML grid element
		this._grid.className = 'micrio-grid';
		this.set(image.$info?.grid); // Parse initial grid string

		// Dispatch 'grid-load' event once all necessary image data is loaded
		const loaded = () => tick().then(() => {
			this.hook(); // Attach event listeners
			micrio.events.dispatch('grid-load');
		});

		// For V4 images, wait for language data to load before considering grid loaded
		if(!image.isV5) micrio._lang.subscribe(l => {
			if(l) Promise.all(this.images.filter(i => (i.$info && 'cultures' in i.$info && i.$info?.cultures as string || '').indexOf(l) >= 0).map(i => once(i.data))).then(loaded);
			else loaded(); // Load immediately if no language needed
		});
		else {
			// For V5, assume data is loaded via archive or individually, load immediately
			loaded();
		}

		micrio.events.dispatch('grid-init', this); // Dispatch grid initialization event
	}

	/** Hooks necessary event listeners for grid interactions. @internal */
	private hook() {
		// Handle custom grid actions triggered by opening markers
		this.micrio.state.marker.subscribe(m => {
			if(m && typeof m != 'string') { // If a marker object is opened
				const d = m.data?._meta; // Check for meta data
				// Handle custom grid cell size defined in marker
				if(d?.gridSize) {
					const s = (typeof d.gridSize == 'number' ? [d.gridSize, d.gridSize]
						: d.gridSize.split(',').map(Number)) as [number, number]; // Parse size
					const micId = this.images.find(i => i.$data?.markers?.find(n => n == m))?.id; // Find image this marker belongs to
					if(micId) this.nextSize.set(micId, s); // Store size for next layout update
				}
				// Handle custom grid actions defined in marker
				tick().then(() => { // Wait a tick to allow potential state changes
					const a = d?.gridAction?.split('|'); // Split action string
					if(a?.length && typeof a[0] == 'string') this.action(a.shift() as string, a.join('|')); // Execute action
				})
			}
		});

		// Handle clicking on grid items if clickable overlay is enabled
		if(this.clickable) {
			this._grid.addEventListener('click', e => {
				const id = (e.target as HTMLElement).dataset.id; // Get image ID from clicked element
				if(id) this.focus(this.images.find(i => i.id == id)); // Focus the corresponding image
			});

			// Show/hide the HTML grid overlay based on tour/marker/focus state
			const placeOrRemove = (t:any) => { if(t) this.removeGrid(); else this.placeGrid(); };
			this.micrio.state.tour.subscribe(placeOrRemove);
			this.micrio.state.marker.subscribe(placeOrRemove);
			this.focussed.subscribe(placeOrRemove);
		}

		// Handle tour events for grid-specific actions
		this.micrio.addEventListener('tour-event', this.tourEvent);
		// Pause/resume individual image animations during serial tours
		this.micrio.addEventListener('serialtour-pause', () => this.images.forEach(i => i.camera.pause()));
		this.micrio.addEventListener('serialtour-play', () => this.images.forEach(i => i.camera.resume()));
	}

	/** Clears any pending timeouts for transitions or fades. @internal */
	private clearTimeouts() : void {
		clearTimeout(this._to);
		clearTimeout(this._fadeTo);
	}

	/**
	 * Sets the grid layout based on an input string or array of image definitions.
	 * This is the main method for changing the grid's content and appearance.
	 *
	 * @param input The grid definition. Can be:
	 *   - A semicolon-separated string following the format defined in `Grid.getString`.
	 *   - An array of {@link MicrioImage} instances.
	 *   - An array of objects `{image: MicrioImage, ...GridImageOptions}`.
	 * @param opts Options controlling the transition and layout.
	 * @returns A Promise that resolves with the array of currently displayed {@link MicrioImage} instances when the transition completes.
	*/
	set(input:string|MicrioImage[]|({image:MicrioImage} & Models.Grid.GridImageOptions)[]='', opts:{
		/** If true, does not add the previous layout to the history stack. */
		noHistory?:boolean;
		/** If true, keeps the HTML grid element in the DOM (used internally). */
		keepGrid?: boolean;
		/** If true, arranges images in a single horizontal row. */
		horizontal?:boolean;
		/** Overrides the default animation duration for the main grid view transition. */
		duration?:number;
		/** If provided, animates the main grid view to this viewport rectangle. */
		view?:Models.Camera.View360;
		/** If true, skips the main grid camera animation. */
		noCamAni?: boolean;
		/** If true, forces area animation even for images not currently visible. */
		forceAreaAni?: boolean;
		/** If true, does not unfocus the currently focused image when setting a new layout. */
		noBlur?: boolean;
		/** If true, skips the fade-in animation for new images. */
		noFade?: boolean;
		/** Specifies the transition animation type (e.g., 'crossfade', 'slide-left', 'behind-delayed'). */
		transition?: Models.Grid.GridSetTransition;
		/** If true, forces animation even if duration is 0. */
		forceAni?: boolean;
		/** If true, limits individual image views to cover their grid cell. */
		coverLimit?: boolean;
		/** If true, sets the initial view of images to cover their grid cell (but doesn't enforce limit). */
		cover?: boolean;
		/** Scale factor (0-1) applied to each grid cell (creates margins). */
		scale?: number;
		/** Overrides the automatic calculation of grid columns. */
		columns?: number;
	}={}) : Promise<MicrioImage[]> { return this.lastPromise = new Promise((ok, err) => {
		// Reset focus point of the main grid image
		delete this.image.$info?.settings?.focus;
		this.lastAction = undefined; // Clear last action

		// Ensure coverLimit implies cover
		if(opts.cover === false && opts.coverLimit) opts.coverLimit = false;
		if(opts.coverLimit && opts.cover == undefined) opts.cover = opts.coverLimit;

		// Convert input array to grid string format if necessary
		if(typeof input != 'string')
			input = input.map(i => i instanceof MicrioImage	? {image:i} : i) // Ensure array of objects
			.filter(g => !!g.image.$info).map(g => this.getString(g.image.$info!, g)).join(';'); // Convert to string

		// Parse the grid string into image definition objects
		const images:Models.Grid.GridImage[] = input.split(';').filter(s => !!s).map(s => this.getImage(s));
		const focussed = this.$focussed; // Get currently focused image
		const isDelayed = opts.transition?.endsWith('-delayed'); // Check for delayed transition
		const isBehindDelay = opts.transition == 'behind-delayed';

		// --- Handle Transition Setup ---
		switch(opts.transition) {
			case 'crossfade':
				opts.duration = 0; // Crossfade implies no main camera animation
			break;
			case 'behind':
			case 'behind-delayed':
				// Setup for 'behind' transition: force animation, set cover limit,
				// set initial areas, and set z-index for delayed effect.
				const isLim = opts.coverLimit === true;
				opts.forceAni = true;
				opts.coverLimit = isLim;
				opts.forceAreaAni = true;
				const vW = isDelayed ? 1/images.length : 1; // Viewport width per image for delay
				let c:number = 0;
				this.images.forEach(i => {
					i.camera.setCoverLimit(isLim);
					if(images.find(e => e.id == i.id)) { // If image is in the new layout
						// Set initial area (full width if focused, partial if delayed)
						i.camera.setArea([0,0,focussed?.id == i.id ? 1 : vW,1], {noDispatch: true, direct: true});
						if(i != focussed) i.camera.setView([0,0,1,1]); // Reset view if not focused
						if(isDelayed) this.micrio.wasm.e._setZIndex(i.ptr, images.length-(c++)); // Set z-index for stacking
					}
				});
				images.forEach(e => e.view = [0,0,1,1]); // Ensure target view is full
			break;
		}

		// --- Apply Durations ---
		const ready = this.image.ptr >= 0; // Is Wasm ready?
		const dur = opts.duration ?? (opts.noHistory ? this.aniDurationOut : this.aniDurationIn); // Determine main animation duration
		const defaultDur = this.nextCrossFadeDuration ?? this.image.$settings.crossfadeDuration ?? 1; // Get default crossfade duration
		const crossfadeDur = (dur || this.aniDurationIn) / (isBehindDelay ? 2 : 1); // Calculate crossfade duration for this transition
		this.nextCrossFadeDuration = undefined; // Reset specific duration override
		if(ready) { // Set durations in Wasm
			const ptr = this.micrio.wasm.getPtr();
			this.micrio.wasm.e.setGridTransitionDuration(ptr, dur);
			this.micrio.wasm.e.setCrossfadeDuration(ptr, crossfadeDur);
		}

		// --- Unfocus & History ---
		const doUnfocus = !opts.noBlur && focussed; // Should we unfocus the current image?
		if(doUnfocus) this.blur(); // Trigger blur (animates focused image back to grid)

		// Add previous layout to history if not disabled
		if(!opts.noHistory && this.current.length) this.depth.set(this.history.push({
			layout: this.current.map(i => this.getString(i.$info as Models.ImageInfo.ImageInfo, {
				view: i.state.$view, // Store current view
				size: this.cellSizes.get(i.id) as [number,number] // Store current size
			})).join(';'),
			horizontal: this.isHorizontal, // Store layout orientation
			view: this.image.camera.getView() // Store main grid view
		}));

		this.isHorizontal = !!opts.horizontal; // Update layout orientation

		// --- Update Images ---
		// Fade out images that are not in the new layout
		this.removeImages(this.images.filter(i => !images.find(n => n.id == i.id)));

		// Calculate and print the HTML grid layout (updates CSS grid)
		this.printGrid(images, {
			horizontal: opts.horizontal,
			keepGrid: opts.keepGrid,
			scale: opts.scale,
			columns: opts.columns
		});

		// Reset any pending timeouts
		this.clearTimeouts();

		let _to:any; // Timeout for overall completion
		let _fto:any; // Timeout for fade-in start
		let resolved:boolean = false; // Flag to prevent multiple resolves/rejects

		// Error handler for camera animations
		const error = () => {
			this.clearTimeouts();
			if(!resolved) err(); // Reject the main promise if not already resolved
		};

		// Animate the main grid camera view if needed
		if(ready && !opts.noCamAni) {
			if(opts.view) this.image.camera.flyToView(opts.view, {duration:dur*1000}).catch(error);
			else this.image.camera.flyToFullView({duration:dur*1000}).catch(error);
		}

		// Reset temporary size map
		this.nextSize.clear();

		// Apply cover limit setting
		if(opts.coverLimit == undefined) opts.coverLimit = true; // Default to true
		if(!opts.coverLimit) images.forEach(i => this.images.find(img => img.id == i.id)?.camera.setCoverLimit(!!opts.coverLimit));

		// --- Place and Animate Images ---
		const isAppear = opts.transition == 'appear-delayed'; // Check for appear transition
		const getDelay = (i:number) : number => i * this.transitionDelay + (i > 0 && isAppear ? dur : 0); // Calculate delay for staggered transitions

		// Place each image in the new layout, applying animations/delays
		this.current = images.map((img,i) => this.placeImage(img, {
			duration: !opts.forceAni && doUnfocus && img.id != focussed?.id ? 0 : dur, // Use 0 duration if unfocusing non-target image
			delay: isDelayed ? getDelay(i) : 0, // Apply calculated delay
			noCamAni: isAppear && i > 0 ? true : !!opts.noCamAni, // Skip camera animation for delayed appear items
			forceAreaAni: isAppear && i > 0 ? false : opts.forceAreaAni, // Control area animation forcing
			cover: opts.cover // Apply cover view setting
		}));

		// For appear transition, fade in images after the first one
		if(isAppear) this.current.slice(1).forEach(i => this.micrio.wasm.e._fadeTo(i.ptr, .9999, true)); // Fade almost fully (hack?)

		// Function to trigger fade-in for all images (potentially delayed)
		const fadeIn = () => this.current.forEach((img,i) =>
			sleep(isDelayed ? (getDelay(i) + (isBehindDelay ? dur/2 : 0)) * 1000 : 0) // Apply delay
				.then(() => this.micrio.wasm.e._fadeIn(img.ptr)) // Trigger fade-in in Wasm
		);

		// Function called when all transitions are complete
		const done = () => {
			this.clearTimeouts(); // Clear any remaining timeouts
			// Reset default crossfade duration in Wasm
			requestAnimationFrame(() => this.micrio.wasm.e.setCrossfadeDuration(this.micrio.wasm.getPtr(), defaultDur));
			// Reset z-index for delayed transitions
			if(isDelayed) this.images.forEach(i => this.micrio.wasm.e._setZIndex(i.ptr, 0));
			// Apply final cover limit state
			if(opts.coverLimit) images.forEach(i => this.images.find(img => img.id == i.id)?.camera.setCoverLimit(!!opts.coverLimit));
			// Place the HTML grid overlay if clickable
			if(this.clickable) this.placeGrid();
			this.lastAction = undefined; // Clear last action
			resolved = true; // Mark as resolved
			ok(this.current); // Resolve the main promise
		}

		// --- Schedule Completion ---
		// If no duration, fade in and complete immediately
		if(!dur && !crossfadeDur) {
			if(!opts.noFade) fadeIn();
			done();
		}
		// Otherwise, set timeouts for fade-in and completion
		else {
			if(!opts.noFade) this._fadeTo = _fto = <unknown>setTimeout(fadeIn, Math.max(0, dur / 2 * 1000)) as number; // Schedule fade-in halfway?
			// Schedule completion after the longest duration (main animation or crossfade + delays)
			this._to = _to = setTimeout(done, (Math.max(crossfadeDur, dur) + (isDelayed ? (images.length-1) * this.transitionDelay : 0))*1000 );
		}
	})}

	/** Checks if the current grid layout differs from the initial full grid layout. @internal */
	private hasChanged() : boolean {
		return this.current.map(i => i.id).join(',') != this.images.map(i => i.id).join(',');
	}

	/**
	 * Parses an individual image grid string into a GridImage object.
	 * @param s The grid string for a single image.
	 * @returns The parsed `Models.Grid.GridImage` object.
	*/
	getImage(s:string) : Models.Grid.GridImage {
		const g = s.split('|'), p = g[0].split(','), // Split main parts and size
			size = (g[1] ? g[1].split(',').map(Number) : [1])  as [number,number?]; // Parse size [w, h?]
		let width:number=0,height:number=0; // Placeholders

		return {
			path: this.image.$info?.path, // Inherit path
			id: p[0],
			width: width=(Number(p[1])||width), // Parse width
			height: height=(Number(p[2])||height), // Parse height
			isDeepZoom: p[3]=='d', // Check type flag
			isPng: p[4]=='p', // Check format flag
			isWebP: p[4]=='w', // Check format flag
			size, // Store parsed size
			view: p[5] ? p[5].split('/').map(Number) as Models.Camera.ViewRect : undefined, // Parse view
			area: p[6] ? p[6].split('/').map(Number) as Models.Camera.ViewRect : undefined, // Parse area
			settings: deepCopy(this.image.$settings||{}, { // Copy base settings
				focus: p[7] ? p[7].split('-').map(Number) as [number, number] : null // Parse focus point
			}),
			/** @ts-ignore cultures might not exist on type */
			cultures: p[8]?.replace(/\-/g,',')||undefined // Parse cultures string
		}
	}

	/**
	 * Converts an ImageInfo object and options back into the grid string format.
	 * @returns The grid encoded string for this image.
	*/
	getString = (i:Models.ImageInfo.ImageInfo, opts:Models.Grid.GridImageOptions = {}) : string => Grid.getString(i, {
		view: opts.view,
		area: opts.area,
		size: opts.size ?? this.nextSize.get(i.id) as [number,number], // Use nextSize if available
		cultures: ('cultures' in i && i['cultures'] ? i.cultures as string : '')?.replace(/,/g,'-') // Format cultures
	});

	/** Calculates the optimal number of columns for the grid layout. @internal */
	private getCols(images:number, numTiles:number) : number {
		// Heuristic based on total tiles and number of images
		let num = Math.ceil(numTiles / Math.ceil(Math.sqrt(numTiles)));
		// If number of images equals total tiles (all 1x1), find a nice divisor near the square root
		if(images == numTiles) {
			const margin = Math.floor(Math.sqrt(images)), cols:number[] = [];
			for(let n = margin; n < num+margin; n++) if(!(images % n)) cols.push(n); // Find divisors
			if(cols.length) num = cols[Math.floor(cols.length / 2)]; // Pick middle divisor
		}
		return num;
	}

	/**
	 * Creates or updates the HTML grid element (`_grid`) based on the provided image definitions.
	 * Calculates the target area for each image based on the CSS grid layout.
	 * @internal
	 * @param images Array of GridImage definitions for the layout.
	 * @param opts Layout options (horizontal, keepGrid, scale, columns).
	*/
	private printGrid(images:Models.Grid.GridImage[], opts:{
		horizontal?:boolean;
		keepGrid?:boolean;
		scale?:number;
		columns?:number;
	}) : void {
		if(!opts.keepGrid) this.removeGrid(); // Remove existing grid if not keeping it
		/** @ts-ignore Calculate total number of grid cells needed */
		const numTiles = images.reduce((n,i) => n+i.size.reduce((v,n) => n*v, 1), 0);
		// Determine number of columns
		const cols = opts.columns ?? (opts.horizontal ? images.length : this.getCols(images.length, numTiles));
		// Apply grid template columns style
		this._grid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
		this._grid.textContent = ''; // Clear existing children
		// Reset transforms
		this._grid.style.removeProperty('--translate');
		this._grid.style.removeProperty('--scale');

		// Create/update button elements for each image
		images.forEach(i => { if(!i.id) return;
			// Get or create button element
			if(!this._buttons.has(i.id)) this._buttons.set(i.id, document.createElement('button'));
			const tile = this._buttons.get(i.id) as HTMLButtonElement;
			// Apply grid area span if size is not 1x1
			if(i.size.toString() != '1') {
				tile.style.gridArea = `auto / auto / span ${i.size[1]} / span ${i.size[0]||i.size[1]}`;
				this.cellSizes.set(i.id, i.size) // Store cell size
			}
			else { // Reset grid area and remove stored size
				tile.style.removeProperty('grid-area');
				this.cellSizes.delete(i.id);
			}
			tile.dataset.id = i.id; // Set image ID on dataset
			this._grid.appendChild(tile); // Add button to grid container
		});

		// Add grid container to the DOM if not already present
		if(!opts.keepGrid || !this._grid.parentNode) this.micrio.insertBefore(this._grid, this.micrio.firstChild?.nextSibling ?? null);

		// Allow external CSS overrides via event
		this.micrio.events.dispatch('grid-layout-set', this);

		// Calculate target area for each image based on its rendered position in the grid
		const w = this.micrio.offsetWidth;
		const h = this.micrio.offsetHeight;
		const s = Math.max(0, Math.min(1, 1 - (opts.scale??1))); // Calculate scale factor for margins
		this._grid.style.transform = ''; // Reset temporary transform
		this._grid.childNodes.forEach((n:ChildNode) => { if(!n) return;
			const e = n as HTMLElement;
			const id = e.dataset.id;
			const r = e.getBoundingClientRect(); // Get rendered position/size
			const img = images.find(i => i.id == id);
			const o = [(s/2)*r.width, (s/2)*r.height]; // Calculate margin offset based on scale
			// Calculate and store the target area [x0, y0, x1, y1] relative to the main canvas
			if(img && !img.area) img.area = [(r.x+o[0])/w, (r.y+o[1])/h, (r.x+r.width-o[0])/w, (r.y+r.height-o[1])/h]
		});

		// Remove the grid element from DOM if it wasn't meant to be kept
		if(!opts.keepGrid) this._grid.remove();
	}

	/** Places the HTML grid overlay element into the DOM and starts listening for view changes. @internal */
	private placeGrid() : void {
		if(!this.clickable || this.micrio.state.$tour || this.micrio.state.$marker) return; // Conditions to show overlay
		if(this._grid.parentNode) return; // Already placed
		this.micrio.insertBefore(this._grid, this.micrio.firstChild?.nextSibling ?? null); // Insert into DOM
		// Subscribe to view changes to update overlay transform
		this.viewUnsub = this.image.state.view.subscribe(this.updateGrid);
	}

	/** Removes the HTML grid overlay element from the DOM and stops listening for view changes. @internal */
	private removeGrid() : void {
		if(!this._grid.parentNode) return; // Already removed
		if(this.viewUnsub) this.viewUnsub(); // Unsubscribe from view changes
		this._grid.remove(); // Remove from DOM
	}

	/** Updates the CSS transform of the HTML grid overlay based on the main image's camera view. @internal */
	private updateGrid() : void {
		const xy = this.image.camera.getXY(0,0, true);
		this._grid.style.setProperty('--translate', `translate3d(${xy[0]}px, ${xy[1]}px, 0)`);
		this._grid.style.setProperty('--scale', this.image.camera.getScale().toString());
		this._grid.dispatchEvent(new CustomEvent('update'));
	}

	/**
	 * Places a single image within the grid layout and initiates its animation/fade-in.
	 * @internal
	 * @param entry The GridImage definition object.
	 * @param opts Options controlling the placement animation.
	 * @returns The placed MicrioImage instance.
	 */
	private placeImage(entry:Models.Grid.GridImage, opts: {
		duration:number; // Animation duration override
		delay:number; // Animation delay
		noCamAni?:boolean; // Skip camera animation?
		forceAreaAni?:boolean; // Force area animation?
		cover?:boolean; // Set initial view to cover?
	}) : MicrioImage {
		// Find or open the MicrioImage instance
		let img = this.images.find(i => i.id == entry.id);
		if(img && entry.area) sleep(opts.delay*1000).then(() => {
			img!.camera.setArea(entry.area!, {
				direct: opts.duration==0 || (!opts.forceAreaAni && !get(img!.visible))
			});
			if(opts.delay) this.micrio.wasm.render();
		});
		else {
			entry.lang = this.micrio.lang;
			this.micrio.wasm.addChild(img = new MicrioImage(this.micrio.wasm, entry, {area: entry.area}), this.image);
			this.images.push(img);
		}
		const aniOpts = {duration:opts.duration*1000, timingFunction: this.timingFunction, limit: false};
		if(!opts.noCamAni && !img.camera.aniDone && img.ptr > 0) {
			const isCover = !!opts.cover || img.camera.getCoverLimit();
			if(entry.view || !isCover) img.camera.flyToView(entry.view ?? [0,0,1,1], aniOpts).catch(() => {})
			else if(entry.area && entry.width && entry.height) {
				const targetRatio = ((entry.area[2] - entry.area[0]) * this.micrio.offsetWidth) / ((entry.area[3] - entry.area[1]) * this.micrio.offsetHeight);
				img.camera.flyToView(targetRatio < (entry.width / entry.height) ? [.5,0,.5,1] : [0,.5,1,.5], aniOpts).catch(() => {});
			}
			else img.camera.flyToCoverView(aniOpts).catch(() => {});
		}

		return img;
	}

	/** Fade out unused images in the grid
	 * @param images The images to hide
	*/
	private removeImages(images:MicrioImage[]) : void {
		images.forEach(i => { if(i.ptr >= 0) this.micrio.wasm.e._fadeOut(i.ptr) });
		this.micrio.wasm.render();
	}


	/** Checks whether current viewed image is (part of) grid */
	insideGrid() : boolean {
		const c = this.micrio.$current;
		return c == this.image || !!this.images.find(i => i == c);
	}

	/** Reset the grid to its initial layout
	 * @param duration Duration in seconds
	 * @param noCamAni Don't do any camera animating
	 * @param forceAni Force animation on all grid images
	 * @returns Promise when the transition is complete
	*/
	async reset(duration?:number, noCamAni?:boolean, forceAni?:boolean) : Promise<MicrioImage[]> {
		const state = this.history[0];
		// Stop any individual running animations
		this.images.forEach(i => i.camera.stop());
		this.image.camera.stop();
		this.markersShown.set([]);
		await tick();
		if(!forceAni && !noCamAni && this.micrio.camera?.isZoomedOut() && !this.micrio.state.$tour && !this.$focussed && !this.hasChanged()) duration = 0;
		return this.set(state?.layout || this.image.$info?.grid, { noHistory: true, duration, noCamAni, forceAni, horizontal: state ? state.horizontal : false }).then(i => {
			this.depth.set(this.history.length = 0);
			this.micrio.current.set(this.image);
			return i;
		});
	}

	/** Immediately switch back to the initial grid view, maintaining the current view
	 * Usable only if the grid is perfect N x N
	 * @internal
	*/
	private switchToGrid() {
		const focus = this.$focussed;
		if(!focus) return;
		const v = focus.camera.getView();
		if(v) this.reset(0, true).then(() => {
			if(focus.opts.area) this.image.camera.setView(focus.opts.area, {noLimit: true});
			focus.camera.setView(v, {noLimit: true});
			this.micrio.current.set(this.image);
		})
	}

	/** Fly to the viewports of any markers containing a class name
	 * @param tag The class name to match
	 * @param duration Optional duration in ms
	 * @param noZoom Don't zoom into the markers, just filter the images
	 * @returns Promise when the transition is complete
	*/
	async flyToMarkers(tag?:string, duration?:number, noZoom?:boolean) : Promise<MicrioImage[]> {
		const spl = tag?.split('|').map(s => s.trim());
		const name = spl?.[0]??'';
		const images = !name ? this.images : this.images.filter(i => !!i.$data?.markers?.find(m => m.tags.includes(name)));
		return this.set(images.map(img => {
			const m = img.$data?.markers?.find(m => m.tags.indexOf(name) >= 0);
			return this.getString(img.$info as Models.ImageInfo.ImageInfo, {
				view: !noZoom ? m?.view : undefined
			})
		}).join(';'),{duration, horizontal: spl?.[1]=='h'});
	}

	/** Go back one step in the grid history
	 * @param duration Optional duration for transition
	 * @returns Promise when the transition is complete
	*/
	async back(duration?:number) : Promise<void> {
		const state = this.history.pop();
		if(!state) return;

		this.depth.set(this.history.length);
		this.micrio.current.set(this.image);

		const focussed = this.$focussed;
		if(focussed) this.blur();

		await this.set(state.layout, {
			duration,
			noHistory: true,
			horizontal: state.horizontal,
			view: state.view
		});
	}

	/** Sets the animation timing function for the next transition. @internal */
	private setTimingFunction(fn:Models.Camera.TimingFunction) : void {
		const mainPtr = this.micrio.wasm.getPtr();
		this.micrio.wasm.e.setGridTransitionTimingFunction(mainPtr, Enums.Camera.TimingFunction[this.timingFunction=fn]);
	}

	/** Open a grid image full size and set it as the main active image
	 * @param img The image
	 * @param opts Focus options
	 * @returns Promise for when the transition completes
	*/
	async focus(img:MicrioImage|undefined, opts: Models.Grid.FocusOptions={}) : Promise<void> {
		if(!img) return this.back();

		if(opts.coverLimit) opts.cover = true;
		const noView = !opts.view && !opts.cover;

		const m = this.micrio;

		// If the grid is not visible, show it first
		if(!get(m.visible).find(i => i == this.image)) m.current.set(this.image);

		// Do direct crossfade if there is a currently focussed image and already in full view
		const focussed = this.$focussed;

		// Already focussed on this image
		if(focussed == img) return;

		const direct = !opts.transition?.startsWith('slide-') && (opts.duration == 0 || (focussed && !m.wasm.e._areaAnimating(focussed.ptr) && !this.current.find(i => i == img)));
		if(direct) img.camera.setArea([0,0,1,1], {noDispatch: true, direct: true});
		if(focussed) this.blur();

		img.camera.setCoverLimit(!!opts.cover);
		this.setTimingFunction('ease');

		const target:string = await this.transition(img, focussed, this.getString(img.$info!, {
			view: opts.view
		}), opts);

		m.wasm.e._setZIndex(img.ptr, 3);
		this.focussed.set(img);

		// If target image current invisible, don't animate camera to target view
		if(!get(img.visible) && (opts.transition == 'crossfade' || !opts.transition))
			opts.duration = 0;

		return this.set(target, {
			noBlur: true,
			duration: opts.duration,
			forceAreaAni: opts.transition != 'crossfade',
			cover: !!opts.cover,
			coverLimit: !!opts.coverLimit
		}).then(() => {
			m.events.dispatch('grid-focus', img);
			const i = img.$info!;
			this.removeGrid();
			if(m.$current != img) m.current.set(img);
			const imgRat = m.offsetWidth / m.offsetHeight,
				rX = (1 - (i.width / i.height) / imgRat) / 2;
			if(!img.camera.aniDone && noView) img.camera.flyToFullView({duration:this.aniDurationIn*1000}).catch(() => {});
			this.image.camera.setLimit([rX, 0, 1 - rX, 1]);
		}).catch(() => {});
	}

	/**
	 * Handles the animation logic for transitioning between grid view and focused view, or between focused images.
	 * @internal
	 */
	private async transition(target:MicrioImage, current:MicrioImage|undefined, layout:string, {
		duration, view, transition, noViewAni, exitView, blur, cover
	}:Models.Grid.FocusOptions) : Promise<string> {
		if(!transition) return layout;

		if(transition == 'crossfade') {
			target.camera.setArea([0,0,1,1]);
			noViewAni = true;
		}

		if(view && noViewAni) target.camera.setView(view, {noRender: true, noLimit: true});

		if(!current || transition == 'crossfade') return layout;

		const isSlwipe = transition.startsWith('slide') || transition.startsWith('swipe');
		const isBehind = transition.startsWith('behind');
		const transDir:(number|undefined) = !isSlwipe ? undefined
			: transition.endsWith('-up') ? 0
			: transition.endsWith('-down') ? 180
			: transition.endsWith('-left') ? 270
			: 90;

		if(isSlwipe || isBehind) this.micrio.wasm.e._fadeTo(target.ptr, .9999, true);

		if(transition.startsWith('slide')) {
			target.camera.setArea(
				transDir == 0 ? [0, -.5, 1, 0]
				: transDir == 180 ? [0, 1, 1, 1.5]
				: transDir == 270 ? [-.5,0,0,1]
				: [1,0,1.5,1], {noDispatch: true, direct: true});
		}
		else if(transition.startsWith('swipe')) {
			target.camera.setArea(
				transDir == 0 ? [0, -1, 1, 0]
				: transDir == 180 ? [0, 1, 1, 2]
				: transDir == 270 ? [-1, 0, 0, 1]
				: [1, 0, 2, 1], {noDispatch: true, direct: true});
			layout = [
				this.getString(current.$info!, {
					view: exitView ?? current.camera.getView(),
					area: transDir == 0 ? [0, 1, 1, 2]
						: transDir == 180 ? [0, -1, 1, 0]
						: transDir == 270 ? [1, 0, 2, 1]
						: [-1, 0, 0, 1]
				}),
				this.getString(target.$info!, {
					view, area: [0, 0, 1, 1]
				})
			].join(';');
		}
		else if(isBehind) {
			target.camera.setArea([0,0,1,1]);
			target.camera.setView([0,0,1,1]);
			const between = [
				this.getString(current.$info!, {view: View.fromRaw([.5,.5,1,1])}),
				this.getString(target.$info!, {view: View.fromRaw([.5,.5,1,1])})
			];
			if(transition == 'behind-left') between.reverse();
			await this.set(between.join(';'), {
				noBlur: true,
				horizontal: true,
				coverLimit: cover
			}).then(() => sleep(200));
		}

		if(blur && !isNaN(blur) && blur > 0) {
			duration = duration ?? this.nextCrossFadeDuration ?? this.aniDurationIn;
			const blurSpeed = duration/2;
			const style = this.micrio.canvas.element.style;
			style.transition = `filter ${blurSpeed}s ease`;
			style.filter = `blur(${blur}px)`;
			setTimeout(() => {
				style.filter = '';
				setTimeout(() => style.transform = '', blurSpeed*1000);
			}, blurSpeed*1000);
		}

		return layout;
	}

	/** Unfocusses any currently focussed image */
	blur() : void {
		const focussed = this.$focussed;
		if(!focussed) return;
		this.micrio.wasm.e._setZIndex(focussed.ptr, 2);
		this.micrio.events.dispatch('grid-blur');
		this.focussed.set(undefined);
		this.image.camera.setLimit([0, 0, 1, 1]);
		this.micrio.current.set(this.image);
	}

	/** Handles tour events, potentially triggering grid actions. @internal */
	private tourEvent(e:Event) {
		const event = (e as CustomEvent).detail as Models.ImageData.Event;

		// Only process grid events
		if(!event || !event.action?.startsWith('grid:')) return;

		// Only deal with activated events
		if(event.active) this.action(event.action.slice(5), event.data, event.end - event.start);
	}

	/** Do an (external) action
	 * @param action The action type enum or string
	 * @param data Optional action data
	 * @param duration Optional action duration
	*/
	action(action:Enums.Grid.GridActionType|string, data?:string, duration?:number) : void {
		/** @ts-ignore */
		if(typeof action == 'string') action = Enums.Grid.GridActionType[action];
		// Only do stuff once
		const key = action+(data??'');
		if(this.lastAction == key) return;
		switch(action) {
			case Enums.Grid.GridActionType.focus:
				const spl = data?.split('|').map(s => s.trim());
				const name = spl?.[0]??'';
				const imgs:MicrioImage[] = name?.split(',')
					.map(i => this.images.find(img => img.id == i?.trim()))
					/** @ts-ignore */
					.filter<MicrioImage>(i => typeof i !== 'undefined');
				if(imgs.length == 1) this.focus(imgs[0], {duration});
				else if(imgs.length > 0) this.set(imgs.map(i => this.getString(i.$info!)).join(';'), {
					duration,
					horizontal: spl?.[1] == 'h'
				});
			break;

			/** Fly inside the grid to the boundaries of the specified images */
			case Enums.Grid.GridActionType.flyTo:
				const images = data?.split(',').map(s => this.current.find(i => i.id == s?.trim()));
				if(images?.length) this.image.camera.flyToView([
					Math.min(...images.map(i => i?.opts.area?.[0] ?? 0)),
					Math.min(...images.map(i => i?.opts.area?.[1] ?? 0)),
					Math.max(...images.map(i => i?.opts.area?.[2] ?? 1)),
					Math.max(...images.map(i => i?.opts.area?.[3] ?? 1)),
				], {duration:duration?duration*1000:undefined}).catch(()=>{});
				else console.warn('Given image IDs gave no current displayed images', event);
			break;

			case Enums.Grid.GridActionType.focusTagged:
				this.flyToMarkers(data, duration);
			break;

			case Enums.Grid.GridActionType.focusWithTagged:
				this.flyToMarkers(data, duration, true);
			break;

			case Enums.Grid.GridActionType.reset:
				this.reset(duration);
			break;

			case Enums.Grid.GridActionType.back:
				this.back(duration);
			break;

			case Enums.Grid.GridActionType.switchToGrid:
				this.switchToGrid();
			break;

			case Enums.Grid.GridActionType.nextFadeDuration:
				this.nextCrossFadeDuration = Number(data);
			break;

			case Enums.Grid.GridActionType.filterTourImages:
				once(this.micrio.state.tour).then(t => { if(!t) return;
					if(!('steps' in t) || !t.stepInfo) return;
					const ids = t.stepInfo.map(s => s.micrioId);
					const str = ids.filter((id, i) => ids.indexOf(id) == i)
						.map(i => this.images.find(img => img.id == i))
						.filter(i => !!i)
						/** @ts-ignore */
						.map(i => this.getString(i.$info!)).join(';')
					if(str) this.set(str, {
						duration,
						horizontal: data == 'h'
					});
				});
			break;

			default:
				console.warn('Warning: unknown grid tour event', event);
			break;
		}

		this.lastAction = key;
	}

	/** Enlarge a specific image idx of the currently shown grid
	 * @param idx The image index of the current grid
	 * @param width The image target number of columns
	 * @param height The image target number of rows
	 * @returns Promise when the transition is completed
	*/
	async enlarge(idx:number, width:number, height:number=width) : Promise<MicrioImage[]> {
		/** @ts-ignore */
		return this.set((this.history[this.history.length-1]?.layout || this.image.$info.grid)
			.split(';').map((v,i) => `${v}|${i==idx ? `${width},${height}` : 1}`).join(';'), {
			noHistory: true,
			keepGrid: true,
			duration: 500
		})
	}

	/** Get the relative in-grid viewport of the image */
	getRelativeView(image:MicrioImage, view:Models.Camera.ViewRect) : Models.Camera.ViewRect {
		const a = image.opts.area ?? [0,0,1,1];
		const vW = a[2]-a[0], vH = a[3]-a[1];
		return [
			a[0] + vW * view[0],
			a[1] + vH * view[1],
			a[0] + vW * view[2],
			a[1] + vH * view[3]
		]
	}}
