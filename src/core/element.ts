import type { Writable } from '$core/store';
import type { Models } from '$types/models';
import type { Camera } from './camera';

import { once } from '$utils/store';
import { deepCopy } from '$utils/object';
import { fetchJson, jsonCache } from '$utils/fetch';
import { idIsV5 } from '$utils/id';
import { MicrioError, getErrorMessage } from '$core/error';
import { DataLoader } from '$utils/dataLoader';
import { ATTRIBUTE_OPTIONS as AO, DEFAULT_INFO, localStorageKeys } from './globals';
import { writable, get } from '$core/store';
import { Engine } from '$render/engine';
import { WebGL } from '$render/webgl';
import { Canvas } from '$render/canvas';
import { Events } from '$core/events/facade';
import { MicrioImage } from './image';
import { State} from './state';
import { GoogleTag } from '$utils/analytics';
import { Grid } from '$grid/grid';
import { Gallery } from '$gallery/controller';
import { tick } from '$core/store';
import { rtlLanguageCodes } from '$core/i18n/locale';
import { i18n, langs } from '$core/i18n/strings';
import { MicrioElement } from '$core/component';
import { cssVars } from './css-vars';
import { createElement } from '$utils/dom';

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
export class HTMLMicrioElement extends MicrioElement {
	/** Observed attributes trigger `attributeChangedCallback` when changed. */
	static get observedAttributes() { return ['id', 'muted', 'data-limited', 'lang']; }

	/** The Micrio library version number. */
	static VERSION:string;

	/** Static cache store for downloaded JSON files (like image info). */
	static jsonCache = jsonCache;

	/** The custom element tag name registered via `customElements.define`. */
	static tag = 'micr-io';

	/** CSS injected into `<head>` when the first `<micr-io>` is connected. */
	static styles = `micr-io{display:block;user-select:none;-webkit-touch-callout:none;overflow:hidden;position:relative;width:100%;height:100%;min-height:200px;backface-visibility:hidden;-webkit-backface-visibility:hidden;background-repeat:no-repeat;background-position:center center;background-size:contain;container-type:size}
micr-io,micr-io button{font-family:var(--micrio-font-family,inherit);font-size:var(--micrio-font-size,inherit);background-color:var(--micrio-background-color,transparent)}
micr-io h3{font-weight:600}
micr-io[dir="rtl"]{--micrio-text-align:right}
canvas.micrio{display:block;position:absolute;top:0;left:0;width:100%!important;height:100%!important;backface-visibility:hidden;user-select:none;-webkit-touch-callout:none;-webkit-user-select:none}
micr-io:not([static]){overscroll-behavior:none}
micr-io[data-hooked]:not([data-panning])>canvas.micrio{cursor:move;cursor:-webkit-grab;cursor:-moz-grab;cursor:-ms-grab;cursor:grab;-ms-content-zooming:none;-ms-touch-action:none;touch-action:none}
micr-io[data-panning]{cursor:-webkit-grabbing;cursor:-moz-grabbing;cursor:-ms-grabbing;cursor:grabbing}
micr-io[data-hooked][data-can-pan]>canvas.micrio{-ms-touch-action:pan-y;touch-action:pan-y;overscroll-behavior:initial}
micr-io>.micrio-grid{position:fixed;top:0;left:0;width:100%;height:100%;display:grid;grid-auto-flow:row dense;grid-gap:0;will-change:transform;transform-origin:left top;--translate:none;--scale:1;transform:var(--translate) scale3d(var(--scale),var(--scale),1)}
micr-io>.micrio-grid>button{background:transparent;border:none;padding:0;margin:0;cursor:pointer;pointer-events:auto;grid-area:auto / auto / span 1 / span 1;pointer-events:auto}
micr-io>.micrio-grid>button.focussed,micr-io>.micrio-grid.grid-pan-zoom,micr-io>.micrio-grid.grid-pan-zoom>button{pointer-events:none}
${cssVars}`;

	/** Flag indicating if the initial print/setup has occurred.
	 * @internal
	*/
	#printed: boolean = false;

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
	#current: MicrioImage|undefined;

	/**
	 * Getter for the current value of the {@link current} store.
	 * Provides direct access to the active {@link MicrioImage} instance.
	 * @readonly
	*/
	get $current():MicrioImage|undefined {return this.#current}

	/** Getter for the virtual {@link Camera} instance of the currently active image. */
	get camera():Camera|undefined {return this.#current?.camera}

	/** The controller managing the HTML `<canvas>` element, resizing, and viewport. */
	public readonly canvas:Canvas = new Canvas(this);

	/** The controller managing user input events (mouse, touch, keyboard) and dispatching custom events. */
	public readonly events:Events = new Events(this);

	/** The main state manager, providing access to various application states (UI visibility, active marker, tour, etc.). See {@link State.Main}. */
	public readonly state:State.Main = new State.Main();

	/** The Google Analytics integration controller. */
	readonly #analytics: GoogleTag = new GoogleTag(this);

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

	/** The root MicrioMain UI component instance.
	 * @internal
	*/
	_ui:any;

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
	#initedFirst: boolean = false;

	/**
	 * Called when an observed attribute changes. Handles changes to `id`, `muted`, `data-limited`, and `lang`.
	 * @internal
	*/
	attributeChangedCallback(attr:keyof Models.Attributes.MicrioCustomAttributes, _oldVal:string, newVal:string) {
		switch(attr) {
			case 'id': {
				if(!this.isConnected || !newVal) return;
				if(!this.#printed) this.#print();
				else this.open(newVal);
			} break;
			case 'muted':
				this.isMuted.set(this.hasAttribute('muted'));
				break;
			case 'data-limited':
				if(this.engine?.vertexBuffer && this.$current?.canvas)
					this.$current.canvas.limited = !!newVal;
				break;
			case 'lang': {
				let prevLang = get(this._lang);
				if(prevLang != newVal) {
					this._lang.set(newVal);
					let baseLang = newVal.split('-')[0];
					i18n.set(langs[newVal] ?? langs[baseLang] ?? langs.en);
					if(newVal) {
						if(rtlLanguageCodes.includes(newVal)) this.setAttribute('dir', 'rtl');
						else this.removeAttribute('dir');
					}
					if(prevLang) this.events.dispatch('lang-switch', newVal);
				}
				break;
			}
		}
	}

	/**
	 * Lifecycle hook called when the element is connected to the DOM.
	 * Provides itself as 'micrio' to descendants, positions the canvas,
	 * sets up the muted property, syncs the internal current reference,
	 * and kicks off initial loading.
	 * @internal
	*/
	onMount() : void {
		this.provide('micrio', this);

		this.canvas.place();
		if(this.id && !this.#printed) this.#print();

		if(!('muted' in this)) {
			Object.defineProperty(this, 'muted', {
				get() { return get(this.isMuted) },
				set(b:boolean) { if(b) this.setAttribute('muted',''); else this.removeAttribute('muted'); }
			});
			this.watch(this.isMuted, b => {
				/** @ts-ignore */
				this['muted'] = b;
				if(b) {
					localStorage.setItem(localStorageKeys.globalMuted, '1');
					this.events.dispatch('audio-mute');
				}
				else {
					localStorage.removeItem(localStorageKeys.globalMuted);
					this.events.dispatch('audio-unmute');
				}
			});
		}

		this.watch(this.current, c => this.#current = c);

		let shown = false;
		once<boolean>(this.loading, {targetValue: false}).then(() => {
			this.setAttribute('data-loaded','');

			this.watch(this.switching, s => {
				if(s) this.setAttribute('data-switching','');
				else {
					if(!shown) tick().then(() => this.events.dispatch('show', this));
					shown = true;
					this.removeAttribute('data-switching');
				}
			});

			const img = this.querySelector('img.preview');
			if(img) setTimeout(() => img.remove(), 500);
		});
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
		this.current.set(undefined);
		this.events.enabled.set(false);
		this.canvas.unhook();
		this.#analytics.unhook();
		this.engine.unbind();
		if(this._ui) this._ui.remove();
		delete this._ui;
		this.webgl.dispose(true);
		this.#printed = false;
	}

	/**
	 * Performs initial setup based on element attributes.
	 * Loads necessary data like galleries, grids, or archives before opening the first image.
	 * Handles lazy loading logic.
	 * @internal
	*/
	async #print() : Promise<void> {
		if(this.#printed) return;
		this.#printed = true;
		await tick();
		const opts = this.#getOptions();
		if(!opts.settings) opts.settings = {};
		if(this.defaultSettings) deepCopy(this.defaultSettings, opts.settings);
		if(opts.settings.noControls) this.state.ui.controls.set(false);

		// Show UI as early as possible so the logo appears during loading
		if (!opts.settings.noLogo) this.#printUI(!!opts.settings.noUI, false);

		if(opts.id && idIsV5(opts.id) && !this.hasAttribute('width') && !this.hasAttribute('height')) {
			const info = await DataLoader.getInfo(opts.id).catch(() => undefined);
			if(info?.albumId) {
				const galleryCtrl = await Gallery.fromAlbum(info.albumId, this.engine, this, {
					startId: opts.id,
					onProgress: (n: number) => this._ui?.setProps?.({loadingProgress: n})
				}).catch(() => null);
				if(galleryCtrl) {
					galleryCtrl.openOn(this);
					return;
				}
			}
		}

		if(opts.id && opts.id.startsWith('http')) {
			const resp = await fetchJson<Record<string, any>>(opts.id).catch(e => { this.printError(e); return undefined; });
			if(!resp) return;

			let gallery: Gallery | null;
			try { gallery = Gallery.fromIIIF(resp, this.engine, this); }
			catch(e) { this.printError(e as Error); return; }
			if(gallery) {
				gallery.openOn(this);
				return;
			}
			const baseId = resp['@id'] || resp.id || opts.id.replace(/info.json$/, '');
			opts.id = baseId;
			opts.width = resp.width;
			opts.height = resp.height;
			opts.isIIIF = true;
			opts.path = baseId.replace(/\/[^/]*$/, '');
			opts.tileSize = resp.tiles?.[0]?.width ?? DEFAULT_INFO.tileSize;
		}

		this.keepRendering = !!opts.settings.keepRendering;
		const doOpen = opts.id || opts.grid;
		this.events.dispatch('print', opts as Models.ImageInfo.ImageInfo);

		if(opts.settings.lazyload !== undefined && 'IntersectionObserver' in window) {
			const observer = new IntersectionObserver(e => {
				if(!e[0] || !e[0].isIntersecting) return;
				observer.unobserve(this);
				if(doOpen) this.open(opts);
			}, { rootMargin: `${opts.settings.lazyload*100}% 0px`});
			observer.observe(this);
		}
		else if(doOpen) requestAnimationFrame(() => this.open(opts));
	}

	/**
	 * Initializes or updates the MicrioMain UI component.
	 * @internal
	 * @param noHTML If true, renders a minimal UI without HTML overlays.
	 * @param noLogo If true, hides the Micrio logo.
	 */
	#printUI(noHTML:boolean, noLogo:boolean) : void {
		if(!this._ui) {
			const el = createElement('micrio-main', { setProps: {noHTML, noLogo}, parent: this });
			this._ui = el;
		} else {
			this._ui.setProps?.({noHTML, noLogo});
		}
	}

	/**
	 * Displays an error message in the UI.
	 * @internal
	 * @param error The error (MicrioError, Error, or string) to display.
	 */
	printError(error?: Error | string): void {
		const message = getErrorMessage(error ?? 'An unknown error has occurred');
		console.error('Error:', message + (error instanceof MicrioError ? ` (${error.code}: ${error.message})`: ''));
		if(!this._ui) this.#printUI(false, false);
		this._ui?.setProps?.({ error: message });
		this.loading.set(false);
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
		if(!this.#printed) this.#print();
		const isId = typeof idOrInfo == 'string';
		const attrOpts = this.#getOptions();
		let i:Partial<Models.ImageInfo.ImageInfo> = isId ? {...attrOpts, id:idOrInfo} : idOrInfo;
		if(!i.settings) i.settings = {};
		if(attrOpts.settings?.gallery?.archive) if(!/\.\d+$/.test(attrOpts.settings.gallery.archive)) delete attrOpts.settings.gallery.archive;
		if(!isId) deepCopy(attrOpts.settings, i.settings);
		if(this.defaultSettings) deepCopy(this.defaultSettings, i.settings);
		if(i.settings?.gallery?.settings) deepCopy(i.settings.gallery.settings, i.settings);

		if(this.$current && i.id == this.$current?.id) return this.$current;

		if(!opts.splitScreen && !opts.gridView && this.$current) this.switching.set(true);
		if(!i.settings.noGTag) this.#analytics.hook();
		this.#printed = true;
		this.#printUI(!!i.settings.noUI, !!i.settings.noLogo);

		let c:MicrioImage|undefined = this.canvases.find(c => i.id && c.id == i.id);
		let isInGrid:boolean = false;
		const grid = this.canvases[0]?.grid;
		if(!c && grid) {
			const gridImage = i.id ? grid.images.find(img => img.id == i.id) : undefined;
			isInGrid = !!gridImage;
			c = i.id ? gridImage : this.canvases[0];
			if(isInGrid && !grid.insideGrid()) this.current.set(this.canvases[0]);
		}
		if(!c) {
			if(this.canvases.length) {
				const main = this.canvases[0];
				i.path = main.dataPath;
				i.lang = this.lang;
			}
			this.canvases.push(c = new MicrioImage(this.engine, i, opts.splitScreen ? { secondaryTo: opts.splitTo ?? this.#current, isPassive: opts.isPassive } : undefined));
		}

		if(opts.gallery) {
			opts.gallery.attach(c);
			this.gallery.set(opts.gallery);
		}

		if(opts.startView) {
			c.state.view.set(i.settings.view = opts.startView);
			if(c.placed && c.engine.ready) c.camera.setView(i.settings.view,{noRender:true});
		}

		if(!this.lang) this.lang = 'en';

		this.engine.load();
		if(!this.webgl.gl) try {
			this.webgl.init();
		} catch(e) {
			this.printError(e as Error);
			return c;
		}

		once(c.info).then(i => { if(!i || !c) return;
			if(!this.#initedFirst) {
				this.canvas.hook();

				switch(this.#current?.$settings?.theme) {
					case 'light': this.setAttribute('data-light-mode',''); break;
					case 'os': this.setAttribute('data-auto-scheme',''); break;
				}

				this.#initedFirst = true;
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
		this.engine.direction = opts.vector?.direction ?? 0;
		this.engine.distanceX = opts.vector?.distanceX ?? 0;
		this.engine.distanceY = opts.vector?.distanceY ?? 0;

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
	 * Parses HTML attributes of the `<micr-io>` element into a partial ImageInfo object.
	 * @internal
	 * @returns A partial {@link Models.ImageInfo.ImageInfo} object containing options derived from attributes.
	*/
	#getOptions(): Partial<Models.ImageInfo.ImageInfo> {
		const sets:Partial<Models.ImageInfo.Settings> = {
			gallery: {} as any // Initialize gallery settings object
		};

		const opts:Partial<Models.ImageInfo.ImageInfo> = {
			settings: sets as Models.ImageInfo.Settings,
			id: this.id // Start with the element's ID
		};

		const setObj = (b:any, f:string, val:any) : void => {
			const p = f.split('.');
			for(let i=0;i<p.length-1;i++) b = b[p[i]];
			b[p[p.length-1]]=val;
		}

		const process = (category: Record<string, any>, convert: (val: string | null, def: any) => any): void => {
			for (const a in category) {
				const d = category[a], val = this.getAttribute(a);
				const f = d.f || a.replace('data-', '');
				const v = convert(val, d);
				if (v !== undefined) setObj(d.r ? opts : sets, f, v);
			}
		};

		process(AO.STRINGS, val => val || undefined);
		process(AO.BOOLEANS, (val, o) => {
			const tr = val != undefined && (val === '' || val === 'true');
			if (tr || val === 'false') return o.n ? !tr : !!tr;
		});
		process(AO.NUMBERS, (val, o) => {
			if (o.dN !== undefined && val == null) val = o.dN;
			if (val == null) return;
			const n = Number(val);
			return isNaN(n) ? undefined : n;
		});
		process(AO.ARRAYS, val => val != null ? val.split(',').map(Number) : undefined);

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


