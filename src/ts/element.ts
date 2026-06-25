import type { Writable } from 'svelte/store';
import type { Models } from '$types/models';
import type { Camera } from './camera';

import type Svelte from '../svelte/Main.svelte';

import { once } from './utils/store';
import { deepCopy } from './utils/object';
import { jsonCache } from './utils/fetch';
import { idIsV5 } from './utils/id';
import { MicrioError } from './utils/error';
import { DataLoader } from './utils/dataLoader';
import { ATTRIBUTE_OPTIONS as AO, BASEPATH_V5, localStorageKeys } from './globals';
import { writable, get } from 'svelte/store';
import { Engine } from './render/engine';
import { WebGL } from './render/webgl';
import { Canvas } from './render/canvas';
import { Events } from './events/facade';
import { MicrioImage } from './image';
import { State} from './state';
import { GoogleTag } from './analytics';
import { Grid } from './nav/grid';
import { Gallery } from './gallery';
import { mount, tick, unmount } from 'svelte';
import { rtlLanguageCodes } from './i18n/locale';
import { i18n, langs } from './i18n/strings';

/**
 * The main Micrio custom HTML element `<micr-io>`.
 * This class acts as the central controller for the Micrio viewer, managing
 * the WebGL canvas, compute engine, Svelte UI, state, events, and image loading.
 *
 * It orchestrates the interaction between different parts of the library and
 * exposes methods and properties for controlling the viewer.
 *
 * @example
 * ```html
 * <micr-io id="image123"></micr-io>
 * <script>
 *   const viewer = document.querySelector('micr-io');
 *   viewer.open('image456');
 *   viewer.addEventListener('marker-click', (e) => console.log(e.detail));
 * </script>
 * ```
 * 
 * {@include ./element.md}
 * 
 * @author Marcel Duin <marcel@micr.io>
*/
export class HTMLMicrioElement extends HTMLElement {
	/** Observed attributes trigger `attributeChangedCallback` when changed. */
	static get observedAttributes() { return ['id', 'muted', 'data-limited', 'lang']; }

	/** Dynamic Svelte constructor, defaults to the main viewer UI.
	 * @internal
	*/
	static Svelte:typeof Svelte;

	/** The Micrio library version number. */
	static VERSION:string;

	/** Static cache store for downloaded JSON files (like image info). */
	static jsonCache = jsonCache;

	/** Flag indicating if the initial print/setup has occurred.
	 * @internal
	*/
	private printed:boolean = false;

	/** Array holding all instantiated {@link MicrioImage} objects managed by this element. */
	readonly canvases: MicrioImage[] = [];

	/**
	 * Writable Svelte store holding the currently active main {@link MicrioImage}.
	 * Use `<micr-io>.open()` to change the active image.
	 * Subscribe to this store to react to image changes.
	 * Access the current value directly using the {@link $current} getter.
	 */
	readonly current:Writable<MicrioImage|undefined> = writable();

	/** Writable Svelte store holding an array of currently visible {@link MicrioImage} instances (relevant for split-screen or grid). */
	readonly visible:Writable<MicrioImage[]> = writable([]);

	/** Internal reference to the current image instance.
	 * @internal
	*/
	_current:MicrioImage|undefined;

	/**
	 * Getter for the current value of the {@link current} store.
	 * Provides direct access to the active {@link MicrioImage} instance.
	 * @readonly
	*/
	get $current():MicrioImage|undefined {return this._current}

	/** Getter for the virtual {@link Camera} instance of the currently active image. */
	get camera():Camera|undefined {return this._current?.camera}

	/** The controller managing the HTML `<canvas>` element, resizing, and viewport. */
	public readonly canvas:Canvas = new Canvas(this);

	/** The controller managing user input events (mouse, touch, keyboard) and dispatching custom events. */
	public readonly events:Events = new Events(this);

	/** The main state manager, providing access to various application states (UI visibility, active marker, tour, etc.). See {@link State.Main}. */
	public readonly state:State.Main = new State.Main();

	/** The Google Analytics integration controller. */
	private readonly analytics:GoogleTag = new GoogleTag(this);

	/** Writable Svelte store indicating if barebone texture downloading is enabled (lower quality, less bandwidth). */
	readonly barebone:Writable<boolean> = writable(false);

	/** The WebGL rendering controller.
	 * @internal
	*/
	readonly webgl:WebGL = new WebGL(this);

	/** The compute engine controller, managing the render loop and tile drawing.
	 * @internal
	*/
	readonly engine:Engine = new Engine(this);

	/** The Svelte UI component instance.
	 * @internal
	*/
	_ui:{setProps?:(p:Partial<MicrioUIProps>) => void}|undefined;

	/** Custom settings object provided programmatically, overriding server-fetched settings. */
	public defaultSettings?:Partial<Models.ImageInfo.Settings> = this.defaultSettings;

	/** Writable Svelte store indicating the overall loading state of the viewer.
	 * @internal
	*/
	readonly loading:Writable<boolean> = writable(true);

	/** Writable Svelte store indicating if the viewer is currently transitioning between images.
	 * @internal
	*/
	readonly switching:Writable<boolean> = writable(false);

	/** Writable Svelte store indicating the global muted state for audio. Synced with the `muted` attribute and localStorage.
	 * @internal
	*/
	readonly isMuted:Writable<boolean> = writable(localStorage.getItem(localStorageKeys.globalMuted) == '1')

	/** Writable Svelte store holding the currently active language code (e.g., 'en', 'nl').
	 * @internal
	*/
	readonly _lang: Writable<string> = writable();

	/** Holds data for the current 360 space, if applicable (loaded via `data-space` attribute or API). */
	spaceData:Models.Spaces.Space|undefined;

	/** The current active gallery controller, if any. */
	readonly gallery: Writable<Gallery|undefined> = writable();

	/** If true, forces the WebGL render loop to run continuously, even when idle.
	 * @internal
	*/
	keepRendering: boolean = false;

	/** For setting first-time hooks
	 * @internal
	 */
	private initedFirst: boolean = false;

	/** @internal Initializes the element and subscribes to internal stores. */
	constructor(){
		super();

		// Keep internal _current property synced with the store
		this.current.subscribe(c => this._current = c);

		let shown = false; // Flag to track if 'show' event was dispatched

		// Once initial loading is complete
		once<boolean>(this.loading, {targetValue: false}).then(() => {
			this.setAttribute('data-loaded',''); // Add attribute indicating loaded state

			// Manage switching state attribute and dispatch 'show' event
			this.switching.subscribe(s => {
				if(s) this.setAttribute('data-switching','');
				else {
					// Dispatch 'show' event only once after loading and switching finishes
					if(!shown) tick().then(() => this.events.dispatch('show', this));
					shown = true;
					this.removeAttribute('data-switching');
				}
			});

			// Remove preview image after a delay
			const img = this.querySelector('img.preview');
			if(img) setTimeout(() => img.remove(), 500);
		});
	}

	/**
	 * Called when an observed attribute changes. Handles changes to `id`, `muted`, `data-limited`, and `lang`.
	 * @internal
	*/
	attributeChangedCallback(attr:keyof Models.Attributes.MicrioCustomAttributes, _oldVal:string, newVal:string) {
		switch(attr) {
			case 'id': { // Handle ID change (initial load or subsequent open)
				if(!this.isConnected || !newVal) return;
				if(!this.printed) this.print(); // Initial setup if not done yet
				else this.open(newVal); // Open the new ID if already set up
			} break;
			case 'muted': // Sync muted attribute with internal store
				this.isMuted.set(this.hasAttribute('muted'));
				break;
			case 'data-limited': // Toggle limited rendering mode
				if(this.engine?._vertexBuffer && this.$current?.ptr)
					this.engine.setLimited(this.$current.ptr, !!newVal);
				break;
			case 'lang': { // Handle language change
				let prevLang = get(this._lang);
				if(prevLang != newVal) {
					this._lang.set(newVal); // Update internal language store
					i18n.set(langs[newVal] ?? langs.en); // Update i18n translations
					if(newVal) { // Set text direction based on language
						if(rtlLanguageCodes.includes(newVal)) this.setAttribute('dir', 'rtl');
						else this.removeAttribute('dir');
					}
					if(prevLang) this.events.dispatch('lang-switch', newVal); // Dispatch event
				}
				break;
			}
		}
	}

	/**
	 * Called when the element is added to the DOM. Sets up canvas and initial print/open.
	 * @internal
	*/
	connectedCallback() : void {
		this.canvas.place(); // Position the canvas element
		// Trigger initial print/load if ID is present
		if(this.id && !this.printed) this.print();
		// Define the 'muted' property and sync it with the store and attribute
		if(!('muted' in this)) {
			Object.defineProperty(this, 'muted', {
				get() { return get(this.isMuted) },
				set(b:boolean) { if(b) this.setAttribute('muted',''); else this.removeAttribute('muted'); }
			});
			this.isMuted.subscribe(b => {
				/** @ts-ignore */
				this['muted'] = b; // Update property
				if(b) {
					localStorage.setItem(localStorageKeys.globalMuted, '1'); // Persist to localStorage
					this.events.dispatch('audio-mute'); // Dispatch event
				}
				else {
					localStorage.removeItem(localStorageKeys.globalMuted);
					this.events.dispatch('audio-unmute');
				}
			})
		}
	}

	// Custom overloads for addEventListener to support fully typed custom Micrio events
	addEventListener<K extends keyof Models.MicrioEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: Models.MicrioEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
	addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
	addEventListener(type: string, listener: (this: HTMLMicrioElement, ev: Event) => any, options?: boolean | AddEventListenerOptions): void;
	addEventListener(type: string, listener: EventListener | EventListenerObject, useCapture?: boolean): void { super.addEventListener(type, listener, useCapture); }

	// Custom overloads for removeEventListener to support fully typed custom Micrio events
	removeEventListener<K extends keyof Models.MicrioEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: Models.MicrioEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
	removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
	removeEventListener(type: string, listener: (this: HTMLMicrioElement, ev: Event) => any, options?: boolean | EventListenerOptions): void;
	removeEventListener(type: string, listener: EventListener | EventListenerObject, useCapture?: boolean): void { super.removeEventListener(type, listener, useCapture); }

	/** Destroys the Micrio instance, cleans up resources, and removes event listeners. */
	destroy() : void {
		this.current.set(undefined); // Clear current image
		this.events.enabled.set(false); // Disable events
		this.canvas.unhook(); // Clean up canvas controller
		this.analytics.unhook(); // Disconnect analytics
		this.engine.unbind(); // Clean up engine resources
		if(this._ui) unmount(this._ui); // Destroy Svelte UI
		delete this._ui;
		this.webgl.dispose(true); // Dispose WebGL context
		this.printed = false; // Reset printed flag
	}

	/**
	 * Performs initial setup based on element attributes.
	 * Loads necessary data like galleries, grids, or archives before opening the first image.
	 * Handles lazy loading logic.
	 * @internal
	*/
	private async print() : Promise<void> {
		if(this.printed) return; // Prevent multiple initializations
		this.printed = true;
		await tick(); // Wait for potential attribute updates
		const opts = this.getOptions(); // Parse attributes into options object
		if(!opts.settings) opts.settings = {};
		if(this.defaultSettings) deepCopy(this.defaultSettings, opts.settings);
		if(opts.settings.noControls) this.state.ui.controls.set(false); // Apply noControls setting

		// --- Album Loading ---
		if(opts.id && idIsV5(opts.id) && !this.hasAttribute('width') && !this.hasAttribute('height')) {
			const info = await DataLoader.getInfo(opts.id).catch(() => undefined);
			if(info?.albumId) {
				const galleryCtrl = await Gallery.fromAlbum(info.albumId, this.engine, this, {
					startId: opts.id,
					onProgress: (n: number) => this._ui?.setProps?.({loadingProgress: n})
				}).catch(() => null);
				if(galleryCtrl) {
					this._openGalleryFromController(galleryCtrl, opts);
					return;
				}
			}
		}

		// --- IIIF Manifest URL as ID ---
		if(opts.id && opts.id.startsWith('http')) {
			const iiifResult = await Gallery.fromIIIF(opts.id, this.engine, this).catch(e => { this.printError(e); return null; });
			if(!iiifResult) return;
			if(iiifResult.gallery) {
				this._openGalleryFromController(iiifResult.gallery, opts);
				return;
			}
			// Single image IIIF — extract info from the manifest/API response
			const galleryItem = Gallery.singleIIIFInfo(iiifResult.response, opts.id);
			opts.id = galleryItem.id;
			opts.width = galleryItem.width;
			opts.height = galleryItem.height;
			opts.isIIIF = true;
			opts.path = galleryItem.path;
			opts.tileSize = galleryItem.tileSize;
		}

		// --- Final Setup & Open ---
		this.keepRendering = !!opts.settings.keepRendering; // Set continuous rendering flag
		const doOpen = opts.id || opts.gallery || opts.grid; // Check if there's something to open
		this.events.dispatch('print', opts as Models.ImageInfo.ImageInfo); // Dispatch 'print' event

		// Handle lazy loading
		if(opts.settings.lazyload !== undefined && 'IntersectionObserver' in window) {
			const observer = new IntersectionObserver(e => {
				if(!e[0] || !e[0].isIntersecting) return; // Ignore if not intersecting
				observer.unobserve(this); // Stop observing
				if(doOpen) this.open(opts); // Open the image/gallery/grid
			}, { rootMargin: `${opts.settings.lazyload*100}% 0px`}); // Configure margin for intersection
			observer.observe(this); // Start observing
		}
		// If not lazy loading, open immediately
		else if(doOpen) requestAnimationFrame(() => this.open(opts));
	}

	/**
	 * Initializes or updates the Svelte UI component.
	 * @internal
	 * @param noHTML If true, renders a minimal UI without HTML overlays.
	 * @param noLogo If true, hides the Micrio logo.
	 */
	private printUI(noHTML:boolean, noLogo:boolean) : void {
		if(!this._ui) this._ui = mount(HTMLMicrioElement.Svelte, {target:this, props:{micrio:this,noHTML,noLogo}}) as NonNullable<typeof this._ui>;
		else this._ui.setProps?.({noHTML, noLogo});
	}

	/**
	 * Displays an error message in the UI.
	 * @internal
	 * @param error The error (MicrioError, Error, or string) to display.
	 */
	printError(error?: Error | string): void {
		// Extract user-friendly message from MicrioError, or use generic fallback
		const message = error instanceof MicrioError 
			? error.displayMessage 
			: (error instanceof Error ? error.message : error) 
			?? 'An unknown error has occurred';
		console.error('Error:', message + (error instanceof MicrioError ? ` (${error.code}: ${error.message})`: ''));
		this._ui?.setProps?.({ error: message });
	}

	/**
	 * Opens a Micrio image by its ID or by providing partial image info data.
	 * This is the primary method for loading and displaying images.
	 *
	 * @param idOrInfo An image ID string (e.g., 'abcdef123') or a partial {@link Models.ImageInfo.ImageInfo} object.
	 * @param opts Options for opening the image.
	 * @returns The {@link MicrioImage} instance being opened.
	*/
	open(idOrInfo:string|Partial<Models.ImageInfo.ImageInfo>, opts:{
		/** If true, keeps the grid view active instead of focusing on the opened image. */
		gridView?: boolean,
		/** If true, opens the image as a secondary split-screen view. */
		splitScreen?: boolean,
		/** The primary image when opening in split-screen mode. Defaults to the current main image. */
		splitTo?: MicrioImage,
		/** If true, opens the split-screen view passively (doesn't take focus). */
		isPassive?: boolean,
		/** An optional starting view to apply immediately. */
		startView?: Models.Camera.View,
		/** For 360 transitions, provides the direction vector from the previous image. */
		vector?: Models.Camera.Vector,
		/** Optional Gallery controller, used for gallery/grid views. */
		gallery?: Gallery,
	}={}) : MicrioImage {
		if(!this.printed) this.print(); // Ensure initial setup is done
		const isId = typeof idOrInfo == 'string';
		const attrOpts = this.getOptions(); // Get options from attributes
		// Merge provided info/ID with attribute options
		let i:Partial<Models.ImageInfo.ImageInfo> = isId ? {...attrOpts, id:idOrInfo} : idOrInfo;
		// Ensure settings object exists
		if(!i.settings) i.settings = {};
		// Clean up legacy gallery archive setting if needed
		if(attrOpts.settings?.gallery?.archive) if(!/\.\d+$/.test(attrOpts.settings.gallery.archive)) delete attrOpts.settings.gallery.archive;
		// Merge attribute settings into provided info object
		if(!isId) deepCopy(attrOpts.settings, i.settings);
		// Merge default settings (programmatically set)
		if(this.defaultSettings) deepCopy(this.defaultSettings, i.settings);
		// Album settings from bundle override defaults
		if(i.settings?.gallery?.settings) deepCopy(i.settings.gallery.settings, i.settings);

		// Check if already opening the current image
		if(this.$current && i.id == this.$current?.id) return this.$current;

		// Set switching state if changing the main image
		if(!opts.splitScreen && !opts.gridView && this.$current) this.switching.set(true);
		// Hook analytics if not disabled
		if(!i.settings.noGTag) this.analytics.hook();
		this.printed = true; // Mark as printed
		// Initialize or update UI
		this.printUI(!!i.settings.noUI, !!i.settings.noLogo);

		// Find or create MicrioImage instance
		let c:MicrioImage|undefined = this.canvases.find(c => i.id && c.id == i.id); // Check existing canvases
		let isInGrid:boolean = false;
		const grid = this.canvases[0]?.grid; // Check if grid exists
		if(!c && grid) { // If not found directly, check if it's part of the grid
			const gridImage = i.id ? grid.images.find(img => img.id == i.id) : undefined;
			isInGrid = !!gridImage;
			c = i.id ? gridImage : this.canvases[0]; // Use grid image or fallback to main grid canvas
			// If opening a grid image but grid isn't focused, set main canvas first
			if(isInGrid && !grid.insideGrid()) this.current.set(this.canvases[0]);
		}
		if(!c) { // If still not found, create a new MicrioImage instance
			if(this.canvases.length) { // Inherit path/lang from existing main image if possible
				const main = this.canvases[0];
				i.path = main.dataPath;
				i.lang = this.lang;
			}
			// Create new instance
			this.canvases.push(c = new MicrioImage(this.engine, i, opts.splitScreen ? { secondaryTo: opts.splitTo ?? this._current, isPassive: opts.isPassive } : undefined));
		}

		// Attach gallery controller if provided
		if(opts.gallery) {
			opts.gallery.attach(c);
			this.gallery.set(opts.gallery);
		}

		// Apply forced start view if provided
		if(opts.startView) {
			c.state.view.set(i.settings.view = opts.startView);
			if(c.ptr > 0 && c.engine.ready) c.camera.setView(i.settings.view,{noRender:true});
		}

		// Set default language if not already set
		if(!this.lang) this.lang = 'en';

		// Load engine then finalize image setup
		this.engine.load();
		// Initialize WebGL
		if(!this.webgl.gl) try {
			this.webgl.init();
		} catch(e) {
			this.printError(e as Error);
			return c;
		}

		// Once image info is loaded
		once(c.info).then(i => { if(!i || !c) return;
			// Initialize WebGL context if not already done
			if(!this.initedFirst) {
				this.canvas.hook(); // Start canvas resize/event listeners

				// Apply theme setting
				switch(this._current?.$settings?.theme) {
					case 'light': this.setAttribute('data-light-mode',''); break;
					case 'os': this.setAttribute('data-auto-scheme',''); break;
				}

				this.initedFirst = true;
			}

			// Initialize grid controller if needed
			if(i.grid && !c.grid) c.grid = new Grid(this, c);

			// Dispatch 'load' event after a tick
			tick().then(() => this.dispatchEvent(new CustomEvent('load', {detail: c})));

			// Start split-screen transition if applicable
			if(opts.splitScreen) tick().then(() => { if(!c) return;
				// If in grid and an animation might be running (check aniDoneAdd queue)
				if(grid?.image.camera.aniDoneAdd && grid.image.camera.aniDoneAdd.length > 0) {
					// Add splitStart to the queue to run after animation finishes
					grid.image.camera.aniDoneAdd.push(() => c?.splitStart());
				} else {
					// Otherwise, start the split screen immediately
					c.splitStart();
				}
			});

		});

		// Set 360 orientation vector for transitions
		this.engine.set360Orientation(
			opts.vector?.direction ?? 0,
			opts.vector?.distanceX ?? 0,
			opts.vector?.distanceY ?? 0);

		// Prevent engine from auto-setting direction if coming from a waypoint
		this.engine.preventDirectionSet = !opts.vector;

		// Handle setting the current image based on context (grid, split, single)
		if(isInGrid && (!opts.gridView || !grid?.current.find(img => img.id == i.id))) {
			// Focus the image within the grid, then set as current
			grid?.focus(c, {view: i.settings?.view}).then(() => this.current.set(c));
		}
		else if(!opts.splitScreen) { // Set as main current image
			this.current.set(c);
		}
		else { // Set as active canvas in engine for split-screen
			this.engine.setCanvas(c);
		}

		// If image has no visual content (e.g., just data), mark loading as finished
		if(c.noImage) this.loading.set(false);

		return c; // Return the MicrioImage instance
	}

	/**
	 * Closes an opened MicrioImage.
	 * For split-screen images, it triggers the split-end transition.
	 * For main images, it removes the canvas from the engine.
	 * @param img The {@link MicrioImage} instance to close.
	*/
	close(img:MicrioImage) : void {
		if(img.opts.secondaryTo) img.splitEnd(); // End split-screen
		else this.engine.removeCanvas(img); // Remove main canvas
	}

	/**
	 * Opens a swipeable gallery from image assets (e.g., marker images).
	 * Creates MicrioImage instances from the provided assets and opens them as a strip-swipe gallery.
	 * @internal
	 * @param images Array of image assets to display in the gallery.
	 * @param startId Optional ID of the image to show first.
	 * @param basePath Optional CDN base path; defaults to the current image's path or BASEPATH.
	 */
	openGallery(images: Models.Assets.Image[], startId?: string, basePath?: string) : void {
		this.printUI(false, true);
		if (!this.engine.ready) this.engine.load();
		if (!this.webgl.gl) this.webgl.init();

		const galleryCtrl = Gallery.fromAssets(images, this.engine, this, { startId, basePath });
		this._openGalleryFromController(galleryCtrl, {});
	}

	/**
	 * Opens a Gallery controller, setting up the parent image and engine state.
	 * @internal
	 */
	private _openGalleryFromController(galleryCtrl: Gallery, baseOpts: Record<string, any>): void {
		const isSwitch = galleryCtrl.type == 'switch' || galleryCtrl.type == 'swipe-full' || galleryCtrl.type == 'omni';
		const galleryInfo: Partial<Models.ImageInfo.ImageInfo> = {};

		if(!isSwitch) {
			galleryInfo.width = this.offsetWidth * this.canvas.getRatio();
			galleryInfo.height = this.offsetHeight * this.canvas.getRatio();
		} else {
			galleryInfo.height = Math.max(...galleryCtrl.images.map(i => i.$info?.height ?? 0));
			galleryInfo.width = Math.max(...galleryCtrl.images.map(i => i.$info?.width ?? 0));
		}

		// Apply config settings to the parent image's settings store
		if(galleryCtrl.config.settings) {
			if(!galleryInfo.settings) galleryInfo.settings = {};
			deepCopy(galleryCtrl.config.settings, galleryInfo.settings as any);
		}

		const gallerySettings: Models.ImageInfo.GallerySettings = {
			type: galleryCtrl.type as any,
			startId: galleryCtrl.config.startId,
			archive: galleryCtrl.config.archive,
			archiveLayerOffset: galleryCtrl.config.archiveLayerOffset,
			isSpreads: galleryCtrl.config.isSpreads,
			coverPages: galleryCtrl.config.coverPages,
			sort: galleryCtrl.config.sort,
			revisions: galleryCtrl.config.revisions
		};

		galleryInfo.settings = {
			...(galleryInfo.settings as any),
			view: [0, 0, 1, 1],
			gallery: gallerySettings,
			pinchZoomOutLimit: isSwitch ? true : undefined
		} as unknown as Models.ImageInfo.Settings;

		if(galleryCtrl.type == 'grid') {
			(galleryInfo.settings as any).zoomLimit = 15;
			(galleryInfo.settings as any).minimap = false;
			// Enable keyboard nav by default when grid is clickable
			if((galleryInfo.settings as any)?.grid?.clickable && (galleryInfo.settings as any)?.hookKeys === undefined) {
				(galleryInfo.settings as any).hookKeys = true;
			}
			galleryInfo.grid = galleryCtrl._gridString;
			// Set the V5 CDN path so Grid children inherit the correct tile base
			galleryInfo.path = DataLoader.getOrganisation()?.baseUrl ?? BASEPATH_V5;
			// Grid type: no gallery children (Grid controller manages its own),
			// and don't pass the Gallery controller to open() — Gallery.svelte must not render.
			this.open(galleryInfo, { ...baseOpts });
			return;
		}

		// Non-grid: set gallery children for engine compatibility, pass controller
		galleryInfo.gallery = galleryCtrl.images;
		this.open(galleryInfo, { ...baseOpts, gallery: galleryCtrl });
	}

	/**
	 * Parses HTML attributes of the `<micr-io>` element into a partial ImageInfo object.
	 * @internal
	 * @returns A partial {@link Models.ImageInfo.ImageInfo} object containing options derived from attributes.
	*/
	private getOptions(): Partial<Models.ImageInfo.ImageInfo> {
		const sets:Partial<Models.ImageInfo.Settings> = {
			gallery: {} // Initialize gallery settings object
		};

		const opts:Partial<Models.ImageInfo.ImageInfo> = {
			settings: sets as Models.ImageInfo.Settings,
			id: this.id // Start with the element's ID
		};

		// Helper to set nested properties
		const setObj = (b:any, f:string, val:any) : void => {
			const p = f.split('.'); // Split path like 'gallery.type'
			for(let i=0;i<p.length-1;i++) b = b[p[i]]; // Traverse path
			b[p[p.length-1]]=val; // Set value at final property
		}

		// Process string attributes
		for(const a in AO.STRINGS) {
			const o = AO.STRINGS[a], val = this.getAttribute(a), f = o.f || a.replace('data-', '');
			if(val) setObj(o.r?opts:sets, f, val); // Use root (opts) or settings (sets) based on 'r' flag
		}
		// Process boolean attributes
		for(const a in AO.BOOLEANS) {
			const o = AO.BOOLEANS[a], val = this.getAttribute(a), f = o.f || a.replace('data-', '');
			const tr = val!=undefined&&val==''||val=='true'; // Check for true values (empty, '', 'true')
			if(tr || val=='false') setObj(o.r?opts:sets,f,o.n ? !tr : !!tr); // Apply boolean value, handle negation ('n' flag)
		}
		// Process number attributes
		for(const a in AO.NUMBERS) {
			const o = AO.NUMBERS[a], f = o.f || a.replace('data-', '');
			let val:string|number|null = this.getAttribute(a);
			if(o.dN !== undefined && val == null) val = o.dN; // Use default number if attribute missing
			if(val != undefined && !isNaN(Number(val))) setObj(o.r ? opts : sets,f,Number(val)); // Convert to number
		}
		// Process array attributes (comma-separated numbers)
		for(const a in AO.ARRAYS) {
			const o = AO.ARRAYS[a], val = this.getAttribute(a), f = o.f || a.replace('data-', '');
			if(val != undefined) setObj(o.r ? opts : sets,f,val.split(',').map(s => Number(s))); // Split and convert to numbers
		}

		// Apply implications of 'static' setting
		if(sets.static) {
			sets.noUI = sets.skipMeta = true;
			sets.hookEvents = false;
		}

		return opts;
	}

	/** Getter for the current language code. */
	get lang() { return get(this._lang) }
	/** Setter for the current language code. Triggers language change logic. */
	set lang(l:string) { this.setAttribute('lang', l) }
}

// --- Svelte UI Props ---
export interface MicrioUIProps {
	/** The main HTMLMicrioElement instance. Provided by element.ts */
	micrio: HTMLMicrioElement;
	/** If true, suppresses rendering of most UI elements (except markers if data-ui="markers"). */
	noHTML: boolean;
	/** If true, suppresses rendering of the Micrio logo. Defaults to `noHTML`. */
	noLogo?: boolean;
	/** Loading progress (0-1), used for the progress indicator. */
	loadingProgress?: number;
	/** Optional error message to display. */
	error?: string|undefined;
}
