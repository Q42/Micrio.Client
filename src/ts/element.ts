import type { Writable } from 'svelte/store';
import type { Models } from '../types/models';
import type { Camera } from './camera';

/** @ts-ignore */
import type Svelte from '../svelte/Main.svelte';

import { once, deepCopy, fetchJson, jsonCache, fetchInfo, fetchAlbumInfo, idIsV5, legacyViewToView360 } from './utils';
import { ATTRIBUTE_OPTIONS as AO, BASEPATH, BASEPATH_V5, localStorageKeys } from './globals';
import { writable, get } from 'svelte/store';
import { Wasm } from './wasm';
import { WebGL } from './webgl';
import { Events } from './events';
import { MicrioImage } from './image';
import { State} from './state';
import { Router } from './router';
import { GoogleTag } from './analytics';
import { Grid } from './grid';
import { archive } from './archive';
import { mount, tick, unmount } from 'svelte';
import { Canvas } from './canvas';
import { rtlLanguageCodes } from './langs';
import { i18n, langs } from './i18n';

/**
 * The main Micrio custom HTML element `<micr-io>`.
 * This class acts as the central controller for the Micrio viewer, managing
 * the WebGL canvas, WebAssembly module, Svelte UI, state, events, and image loading.
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
 * [[include:./ts/element.md]]
 * 
 * @author Marcel Duin <marcel@micr.io>
*/
export class HTMLMicrioElement extends HTMLElement {
	/** Observed attributes trigger `attributeChangedCallback` when changed. */
	static get observedAttributes() { return ['id', 'muted', 'data-grid', 'data-limited', 'lang']; }

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
	public readonly state:State.Main = new State.Main(this);

	/** The Google Analytics integration controller. */
	private readonly analytics:GoogleTag = new GoogleTag(this);

	/** The URL router, handling deep linking and history management. */
	private readonly _router:Router = new Router(this);

	/** Writable Svelte store indicating if barebone texture downloading is enabled (lower quality, less bandwidth). */
	readonly barebone:Writable<boolean> = writable(false);

	/** The WebGL rendering controller.
	 * @internal
	*/
	readonly webgl:WebGL = new WebGL(this);

	/** The WebAssembly module controller, handling communication with the C++ core.
	 * @internal
	*/
	readonly wasm:Wasm = new Wasm(this);

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

	/** If true, forces the WebGL render loop to run continuously, even when idle.
	 * @internal
	*/
	keepRendering: boolean = false;

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
	 * Called when an observed attribute changes. Handles changes to `id`, `muted`, `data-grid`, `data-limited`, and `lang`.
	 * @internal
	*/
	attributeChangedCallback(attr:keyof Models.Attributes.MicrioCustomAttributes, oldVal:string, newVal:string) {
		switch(attr) {
			case 'id': { // Handle ID change (initial load or subsequent open)
				if(!this.isConnected || !newVal) return;
				if(!this.printed) this.print(); // Initial setup if not done yet
				else this.open(newVal); // Open the new ID if already set up
			} break;
			case 'muted': // Sync muted attribute with internal store
				this.isMuted.set(newVal!==null);
				break;
			case 'data-grid': // Handle grid attribute change
				if(!this.printed) this.print(); // Initial setup
				else this.$current?.grid?.set(newVal); // Update grid state
				break;
			case 'data-limited': // Toggle limited rendering mode in Wasm
				if(this.wasm?._vertexBuffer && this.$current?.ptr)
					this.wasm.e._setLimited(this.$current.ptr, !!newVal);
				break;
			case 'lang': { // Handle language change
				let prevLang = get(this._lang);
				if(prevLang != newVal) {
					this._lang.set(newVal); // Update internal language store
					i18n.set(langs[newVal] ?? langs.en); // Update i18n translations
					if(newVal) { // Set text direction based on language
						if(rtlLanguageCodes.indexOf(newVal) >= 0) this.setAttribute('dir', 'rtl');
						else this.removeAttribute('dir');
					}
					if(prevLang) this.events.dispatch('lang-switch', newVal); // Dispatch event
				}
				break;
			}
		}
	}

	/**
	 * Called when the element is added to the DOM. Sets up canvas, router, and initial print/open.
	 * @internal
	*/
	connectedCallback() : void {
		this.canvas.place(); // Position the canvas element
		// Hook up router if enabled
		if((this.hasAttribute('data-router') || this.hasAttribute('data-space'))
			&& this.getAttribute('data-router') != 'false') this._router.hook();
		// Trigger initial print/load if ID or gallery attribute is present
		if((this.id || this.hasAttribute('data-gallery')) && !this.printed) this.print();
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
		this._router.unhook(); // Disconnect router
		this.events.enabled.set(false); // Disable events
		this.canvas.unhook(); // Clean up canvas controller
		this.analytics.unhook(); // Disconnect analytics
		this.wasm.unbind(); // Clean up Wasm resources
		if(this._ui) unmount(this._ui); // Destroy Svelte UI
		delete this._ui;
		this.webgl.dispose(true); // Dispose WebGL context
		this.printed = false; // Reset printed flag
	}

	/**
	 * Loads a binary archive file (.bin) containing gallery/album data.
	 * @internal
	 * @param path Base path for the archive file.
	 * @param id Archive ID (e.g., 'g/[folderId].[revision]').
	 * @returns Promise that resolves when the archive is loaded.
	 */
	private loadArchiveBin(path:string, id:string) : Promise<void> {
		this.printUI(true, true); // Print minimal UI for loading progress
		// Use the archive utility to load and report progress
		return archive.load(path, 'g/'+id, loadingProgress => this._ui?.setProps?.({loadingProgress}));
	}

	/**
	 * Loads album information for a V5 album ID, then loads the associated archive and gallery.
	 * @internal
	 * @param id V5 Album ID (e.g., 'aBcDeF123').
	 * @param opts Partial image info options to merge.
	 * @returns Promise that resolves when the album and gallery are loaded.
	 */
	private loadV5Album = (id:string, opts:Partial<Models.ImageInfo.ImageInfo>) : Promise<void> => fetchAlbumInfo(id).then((aInfo) => {
		if(!aInfo) return; // Exit if album info not found
		const archiveId = aInfo.id+'.'+aInfo.revision; // Construct archive ID
		const path = opts.path = aInfo.organisation?.baseUrl ?? BASEPATH_V5; // Determine base path
		// Merge album info into options
		opts.organisation = aInfo.organisation;
		opts.settings!.album = aInfo;
		opts.settings!.gallery = {
			archive: archiveId,
			sort: aInfo.sort,
			type: aInfo.type,
			startId: opts.id, // Store original ID as startId
			isSpreads: aInfo.isSpreads,
			coverPages: aInfo.coverPages,
			revisions: aInfo.published
		};
		delete opts.id; // Remove original ID, gallery logic will handle it
		// Load the archive binary, then load the gallery data
		return this.loadArchiveBin(path, archiveId)
			.then(() => this.loadGallery(opts, path, true));
	}, (e) => this.printError(e?.message || e)); // Handle fetch errors

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
		if(opts.settings.noControls) this.state.ui.controls.set(false); // Apply noControls setting

		// --- Gallery/Grid/Album Loading ---
		if(opts.settings.gallery?.archive) { // If gallery archive is specified
			const galleryArchive = opts.settings.gallery?.archive;
			const isV5Archive = /\.\d+$/.test(galleryArchive); // Check if it's a V5 revisioned archive
			const path = opts.path||(idIsV5(galleryArchive.replace(/\.\d+$/,'')) ? BASEPATH_V5 : BASEPATH); // Determine path
			if(isV5Archive) await this.loadArchiveBin(path, galleryArchive); // Load V5 archive binary
			opts.settings.gallery.startId = opts.id; // Store original ID
			if(opts.grid) await this.setGrid(opts, path); // Handle grid setup
			else await this.loadGallery(opts, path, isV5Archive); // Handle gallery setup
			if(!isV5Archive) delete opts.settings.gallery.archive; // Remove archive if not V5 (legacy gallery string)
			if(!opts.path) opts.path = path; // Store determined path
			delete opts.id; // Remove original ID
		}
		else if(opts.id?.startsWith('album/')) { // If ID is an album ID
			await this.loadV5Album(opts.id.replace('album/', ''), opts);
		}
		else if(opts.id && idIsV5(opts.id) && !this.hasAttribute('width') && !this.hasAttribute('height')) { // If ID is V5 and might belong to an album
			// Fetch image info to check for albumId, then load the album if found
			await fetchInfo(opts.id, opts.forceInfoPath ? opts.path : undefined, opts.settings?.forceDataRefresh).then(i => i?.albumId ? this.loadV5Album(i.albumId, opts) : undefined);
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
		//@ts-ignore
		if(!this._ui) this._ui = mount(HTMLMicrioElement.Svelte, {target:this, props:{micrio:this,noHTML,noLogo}})
		else this._ui.setProps?.({noHTML, noLogo});
	}

	/**
	 * Displays an error message in the UI.
	 * @internal
	 * @param str The error message string.
	 */
	printError(str?:string) : void {
		this._ui?.setProps?.({error: str??'An unknown error has occurred'});
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
		startView?: Models.Camera.View360,
		/** For 360 transitions, provides the direction vector from the previous image. */
		vector?: Models.Camera.Vector,
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
			this.canvases.push(c = new MicrioImage(this.wasm, i, opts.splitScreen ? { secondaryTo: opts.splitTo ?? this._current, isPassive: opts.isPassive } : undefined));

			// Apply saved state if available
			const stateData = this.state.value && this.state.value.c.find(c => c[0] == i.id);
			if(stateData) c.state.set(stateData);
		}

		// Apply forced start view if provided
		if(opts.startView) {
			c.state.view.set(i.settings.view = opts.startView);
			if(c.ptr && c.camera.e) c.camera.setView(i.settings.view,{noRender:true}); // Set immediately if camera ready
		}

		// Set default language if not already set
		if(!this.lang) this.lang = 'en';

		// Function to finalize image setup after Wasm/info loaded
		const setImage = () => { if(!c) return;
			// Once image info is loaded
			once(c.info).then(i => { if(!i || !c) return;
				// Initialize WebGL context if not already done
				if(!this.webgl.gl) {
					this.webgl.init();
					this.canvas.hook(); // Start canvas resize/event listeners

					// Apply theme setting
					switch(i.settings?.theme) {
						case 'light': this.setAttribute('data-light-mode',''); break;
						case 'os': this.setAttribute('data-auto-scheme',''); break;
					}
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
			this.wasm.e.set360Orientation(this.wasm.getPtr(),
				opts.vector?.direction ?? 0,
				opts.vector?.distanceX ?? 0,
				opts.vector?.distanceY ?? 0);

			// Prevent Wasm from auto-setting direction if coming from a waypoint
			this.wasm.preventDirectionSet = !opts.vector;

			// Handle setting the current image based on context (grid, split, single)
			if(isInGrid && (!opts.gridView || !grid?.current.find(img => img.id == i.id))) {
				// Focus the image within the grid, then set as current
				grid?.focus(c, {view: i.settings?.view}).then(() => this.current.set(c));
			}
			else if(!opts.splitScreen) { // Set as main current image
				this.current.set(c);
			}
			else { // Set as active canvas in Wasm for split-screen
				this.wasm.setCanvas(c);
			}
		}

		// Load Wasm if needed, then finalize image setup
		if(!this.wasm.ready) this.wasm.load().then(setImage);
		else setImage();

		// If image has no visual content (e.g., just data), mark loading as finished
		if(c.noImage) this.loading.set(false);

		return c; // Return the MicrioImage instance
	}

	/**
	 * Closes an opened MicrioImage.
	 * For split-screen images, it triggers the split-end transition.
	 * For main images, it removes the canvas from the Wasm controller.
	 * @param img The {@link MicrioImage} instance to close.
	*/
	close(img:MicrioImage) : void {
		if(img.opts.secondaryTo) img.splitEnd(); // End split-screen
		else this.wasm.removeCanvas(img); // Remove main canvas
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

		// If grid attribute points to an archive, use it for gallery settings too
		if(opts.settings && opts.grid && opts.grid.indexOf('.') > 0) opts.settings.gallery!.archive = opts.grid;

		return opts;
	}

	/**
	 * Parses a gallery string or archive data to load image information and create MicrioImage instances for each page.
	 * Sets up the main options object (`opts`) for a gallery view.
	 * @internal
	 * @param opts The partial ImageInfo object to populate.
	 * @param path The base path for image assets.
	 * @param isArchive Indicates if the gallery data comes from a loaded archive index.
	*/
	private async loadGallery(opts:Partial<Models.ImageInfo.ImageInfo>, path:string, isArchive:boolean) : Promise<void> {
		let gallery = opts.settings?.gallery;
		let archiveId = gallery?.archive; // Can be archive ID or legacy gallery string
		if(!gallery || !archiveId) return; // Exit if no gallery info
		const sets = opts.settings!;

		// If it's an archive, load the index and sort/format the image list
		if(isArchive) {
			const index = await this.getArchiveIndex(archiveId.split('.')[0], path); // Load index JSON
			gallery.archiveLayerOffset = index.delta; // Store layer offset if present
			// Sort images based on gallery settings and format into legacy string format
			archiveId = index.images.sort(
				gallery.sort == 'name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0
				: gallery.sort == '-name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? 1 : a.title > b.title ? -1 : 0
				: gallery.sort == '-created' ? (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? 1 : a.created > b.created ? -1 : 0
				: (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? -1 : a.created > b.created ? 1 : 0
				).map(i => `${i.id},${i.width},${i.height},${i.isDeepZoom?'d':''},${i.isPng ? 'p' : i.isWebP ? 'w' : ''},${i.tileSize || ''}`.replace(/\,+$/,'')) // Format: id,w,h,type,format,tileSize
				.join(';');
		}

		// Parse the gallery string (either original or formatted from archive)
		const entries = archiveId.split(';').map(t => t.trim());

		// Fetch info for legacy galleries using full URLs (if not from archive)
		if(!isArchive) {
			const promises = entries.filter(t => t.startsWith('http')).map(u => fetchJson<Partial<Models.ImageInfo.ImageInfo>>(u));
			if(promises.length) await Promise.all(promises).then(r => r.forEach((d, i:number) => { if(!d) return;
				// Replace URL entry with formatted string
				/** @ts-ignore */
				entries[i] = `${d['@id']},${d.width},${d.height}`;
			}));
		}

		// Parse entries into structured page data
		const pages = entries.map((e:string) : any[] => e.split(',')
			.map((v:any) => isNaN(v) ? v : Number(v))); // [id, w, h, type?, format?, tileSize?]
		// Fill missing dimensions from previous entry (legacy format quirk)
		pages.forEach((p,i) => { if(i>0&&!p[2]) p.push(...pages[i-1].slice(1)) });

		// Calculate dimensions for the main gallery canvas
		const h = opts.height = Math.max(...pages.map(p => p[2])); // Max height of all pages
		if(!gallery.type) gallery.type = 'swipe'; // Default gallery type
		const isSwitch = gallery.type == 'switch' || gallery.type == 'swipe-full' || gallery.type == 'omni'; // Types where pages overlap
		const isSpreads = gallery.isSpreads; // Are pages displayed as spreads?
		const marginX = isSpreads && !isSwitch ? Math.round(pages[0][1] / 20) : 0; // Margin between pages for non-switch spreads
		const coverPages = isSpreads ? gallery.coverPages ?? 0 : 0; // Number of initial single cover pages
		// Calculate total width based on type (sum widths or max width)
		const w = opts.width = isSwitch ? Math.max(...pages.map(p => p[1] * (isSpreads ? 2 : 1))) : pages.reduce((w, c) => w + c[1] + marginX, 0);

		let l=0; // Running left offset for horizontal layout
		// Create MicrioImage instances for each page
		opts.gallery = pages.map((c,i) => new MicrioImage(this.wasm, {
				id: c[0], path, width: c[1], height: c[2], isDeepZoom: c[3] == 'd',
				isPng: c[4] == 'p', isWebP: c[4] == 'w', tileSize: c[5]||1024,
				revision: gallery?.revisions?.[c[0]], // Add revision if available
				settings: { skipMeta: true, gallery } // Basic settings
			}, { // Embed options
				isEmbed: isSwitch, // Mark as embed for switch types
				useParentCamera: isSwitch, // Use main gallery camera for switch types
				// Calculate placement area within the main gallery canvas
				area: isSwitch ? !isSpreads ? [0,0,1,1] // Overlap fully
					// Handle spreads for switch type (cover, left, right)
					: i-coverPages < 0 || (i == pages.length-1 && (i-coverPages)%2==0) ? [0.25,0,0.75,1] // Single cover/last page
					: (i-coverPages)%2==0 ? [0,0,.5,1] // Left page
					: [.5,0,1,1] // Right page
					// Calculate horizontal placement for non-switch types
					: [(l+=i>0&&((i<coverPages)||(i-coverPages)%2==0)?marginX:0)/w, // Left edge (add margin)
						(h-c[2])/2/h, // Top edge (center vertically)
						(l+=c[1])/w, // Right edge
						((h-c[2])/2+c[2])/h] // Bottom edge
			})
		);
		sets.pinchZoomOutLimit = true; // Enable zoom out limit for galleries
		// Set initial view to the starting page's area
		if(opts.gallery.length) sets.view = legacyViewToView360(opts.gallery[Math.max(0, opts.gallery.findIndex(i => i.id == gallery!.startId))].opts.area);
	}

	/** Holds loaded grid info data if applicable. */
	gridInfoData:{images: Models.ImageInfo.ImageInfo[]}|undefined;
	/**
	 * Sets up options for a grid view based on attribute or archive data.
	 * @internal
	 * @param opts The partial ImageInfo object to populate.
	 * @param path The base path for image assets.
	 */
	private async setGrid(opts:Partial<Models.ImageInfo.ImageInfo>, path:string) : Promise<void> {
		if(!opts.settings || !opts.grid) return; // Exit if no grid info
		// If grid attribute points to an archive, load index and format grid string
		if(opts.settings.gallery?.archive == opts.grid) {
			this.gridInfoData=await this.getArchiveIndex(opts.grid.split('.')[0], path); // Load index
			// Format grid string from image info
			opts.grid = this.gridInfoData.images.map(i =>
				Grid.getString(i, {cultures: 'cultures' in i ? (<unknown>i.cultures as string[]).join('-') : undefined})
			).join(';');
		}
		// Set default dimensions and settings for grid view
		opts.width = this.offsetWidth * this.canvas.getRatio();
		opts.height = this.offsetHeight * this.canvas.getRatio();
		opts.settings.zoomLimit = 15;
		opts.settings.minimap = false;
		opts.settings.initType = 'cover';
		this.removeAttribute('data-grid'); // Remove attribute after processing
	}

	/**
	 * Retrieves the index JSON file for a given archive ID.
	 * Uses the archive utility which handles caching.
	 * @internal
	 * @param id Archive ID (folder ID).
	 * @param path Base path for the archive.
	 * @returns Promise resolving to the archive index data.
	 */
	private getArchiveIndex = async (id:string,path:string=BASEPATH) : Promise<{delta?:number; images: Models.ImageInfo.ImageInfo[]}> =>
		archive.get<{images: Models.ImageInfo.ImageInfo[]}>(`${path}${id}.json`) // Get JSON from archive utility
			.then(r => { r.images.forEach(i => jsonCache.set(`${path}${i.id}/info.json`, i)); return r }); // Cache individual image infos and return result

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
