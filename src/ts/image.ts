import type { Models } from '../types/models';
import type { Readable, Unsubscriber, Writable } from 'svelte/store';
import type { Grid } from './grid';
import type { Wasm } from './wasm';
import type { GallerySwiper } from './swiper';
import type { PREDEFINED } from '../types/internal';
import type { HTMLMicrioElement } from './element'; // Import HTMLMicrioElement type

import { BASEPATH, BASEPATH_V5, BASEPATH_V5_EU, DEFAULT_INFO, DEMO_IDS } from './globals';
import { Camera } from './camera';
import { readable, writable, get } from 'svelte/store';
import { createGUID, deepCopy, fetchInfo, fetchJson, getIdVal, getLocalData, idIsV5, isFetching, isLegacyViews, loadSerialTour, once, sanitizeImageData, sanitizeMarker } from './utils';
import { State } from './state';
import { archive } from './archive';

/** Keep track of already loaded scripts-- only do this once per session
 * @private
*/
const jsCss:string[] = [];

/**
 * Represents and controls a single Micrio image instance within the viewer.
 * This class manages the image's metadata (info), cultural data (data),
 * settings, camera, state, and interactions with the WebAssembly module
 * for rendering and processing. It handles loading image tiles, embeds,
 * markers, tours, and galleries associated with the image.
 *
 * Instances are typically created and managed by the main {@link HTMLMicrioElement}.
 * @author Marcel Duin <marcel@micr.io>
*/
export class MicrioImage {
	/** The unique identifier (Micrio ID) for this image. */
	readonly id: string;

	/** A unique instance identifier (UUID) generated for this specific instance. */
	readonly uuid: string = createGUID();

	/** Internal storage for the image info data.
	 * @internal
	 * @readonly
	*/
	private __info:Models.ImageInfo.ImageInfo = JSON.parse(JSON.stringify(DEFAULT_INFO));

	/** Svelte Readable store holding the image's core information (dimensions, format, settings, etc.). See {@link Models.ImageInfo.ImageInfo}. */
	readonly info: Readable<Models.ImageInfo.ImageInfo|undefined>;

	/** Getter for the current value of the {@link info} store.
	 * @readonly
	*/
	get $info():Models.ImageInfo.ImageInfo|undefined { return this.__info }

	/** Svelte Writable store holding the image's specific settings, often merged from attributes and info data. See {@link Models.ImageInfo.Settings}. */
	readonly settings: Writable<Models.ImageInfo.Settings> = writable({});

	/** Getter for the current value of the {@link settings} store. */
	get $settings():Models.ImageInfo.Settings { return get(this.settings) }

	/** Svelte Writable store holding the image's cultural data (markers, tours, text content for the current language). See {@link Models.ImageData.ImageData}. */
	readonly data: Writable<Models.ImageData.ImageData|undefined> = writable(undefined);

	/** Getter for the current value of the {@link data} store. */
	get $data():Models.ImageData.ImageData|undefined { return get(this.data) }

	/** State manager specific to this image instance (view, active marker, etc.). See {@link State.Image}. */
	public readonly state:State.Image;

	/** The virtual camera instance controlling the view for this image. */
	public camera!:Camera;

	/** Svelte Writable store holding the HTMLVideoElement if this image represents a video. */
	public readonly video:Writable<HTMLVideoElement|undefined> = writable(undefined);

	/** Svelte Writable store indicating if this image's canvas is currently visible and being rendered.
	 * @readonly
	*/
	public readonly visible: Writable<boolean> = writable(false);

	/** Album information if this image is part of a V5 album. */
	public album?: Models.Album|undefined;

	/** Gallery swiper instance, if this image is part of a swipe gallery. */
	public swiper: GallerySwiper|undefined;

	/** Stores the camera view state when a marker is opened, used to return to the previous view. */
	openedView: Models.Camera.View|undefined;

	/** Internal reference to the video element.
	 * @internal
	*/
	_video:HTMLVideoElement|undefined;

	/** Base path URI for fetching the `info.json` file. Undefined defaults to Micrio's CDN.
	 * @internal
	*/
	private infoBasePath: string|undefined;

	/** Base path URI for fetching `data.[lang].json` files. */
	dataPath: string;

	/** Stores an error message if loading failed. */
	error: string|undefined;

	/** Pointer to the image instance within the WebAssembly module's memory.
	 * @readonly
	 * @internal
	*/
	ptr: number = -1;

	/** Base tile index within the WebAssembly texture atlas.
	 * @readonly
	 * @internal
	*/
	baseTileIdx: number = -1;

	/** Flag indicating if this is a 360 panoramic image.
	 * @readonly
	 * @internal
	*/
	is360: boolean = false;

	/** Flag indicating if this represents a video texture.
	 * @readonly
	 * @internal
	*/
	isVideo: boolean = false;

	/** Flag indicating if this is an Omni (3D object) viewer.
	 * @readonly
	 * @internal
	*/
	isOmni: boolean = false;

	/** Number of zoom levels available for this image.
	 * @readonly
	 * @internal
	*/
	levels: number = 1;

	/** Number of DeepZoom levels (used for IIIF/DZI).
	 * @readonly
	 * @internal
	*/
	dzLevels: number = 0;

	/** Source URL for the image thumbnail.
	 * @readonly
	 * @internal
	*/
	thumbSrc?: string;

	/** File extension for image tiles (e.g., 'jpg', 'png', 'webp').
	 * @readonly
	 * @internal
	*/
	extension: string|undefined;

	/** Flag indicating if this is a virtual canvas (e.g., gallery container) without its own image tiles.
	 * @readonly
	 * @internal
	*/
	noImage: boolean = false;

	/** Initial opacity when the image is added (used for embeds/transitions).
	 * @readonly
	 * @internal
	*/
	opacity: number = 1;

	/** Svelte Writable store holding the calculated pixel viewport [left, top, width, height] of this image within the main canvas. */
	public readonly viewport:Writable<Models.Camera.ViewRect> = writable<Models.Camera.ViewRect>();

	/** Predefined local data (info, data) if available.
	 * @internal
	*/
	readonly preset: PREDEFINED|undefined;

	/** Array of child {@link MicrioImage} instances embedded within this image. */
	readonly embeds: MicrioImage[] = [];

	/** Grid controller instance, if this image is a grid container. */
	public grid: Grid|undefined;

	/** Flag indicating if the image uses the V5 data model (language handling).
	 * @internal
	 * @readonly
	*/
	isV5:boolean = false;

	/** Base path for fetching image tiles. */
	tileBase:string|undefined;

	/**
	 * Creates a new MicrioImage instance. Typically called by {@link HTMLMicrioElement.open}.
	 * @internal
	 * @param wasm The global Wasm controller instance.
	 * @param attr Initial image info/settings, often from HTML attributes or parent data.
	 * @param opts Options controlling behavior (embedding, split-screen, etc.).
	 */
	constructor(
		public wasm: Wasm,
		private attr:Partial<Models.ImageInfo.ImageInfo>,
		public opts:{
			/** Optional sub area [x0, y0, x1, y1] defining placement within a parent canvas (for embeds/galleries). */
			area?: Models.Camera.ViewRect;
			/** For split screen, the primary image this one is secondary to. */
			secondaryTo?: MicrioImage;
			/** If true, passively follows the view changes of the primary split-screen image. */
			isPassive?: boolean;
			/** If true, this image is embedded within another image (affects rendering/camera). */
			isEmbed?: boolean;
			/** If true, uses the parent image's camera instead of creating its own (for switch/omni galleries). */
			useParentCamera?: boolean;
		} = {}
	) {
		this.state = new State.Image(this); // Initialize state manager
		// Initialize camera unless using parent's
		if(!opts.useParentCamera) this.camera = new Camera(this);

		this.id = (attr.id??'').replace('https://i.micr.io/',''); // Sanitize ID
		this.isV5 = idIsV5(this.id.split('/')[0]); // Check if ID format indicates V5
		// Determine base paths for info and data JSON
		this.infoBasePath = attr.path && attr.forceInfoPath ? attr.path : undefined;
		this.dataPath = attr.path||this.__info.path;
		if(this.isV5 && !attr.path) this.dataPath = BASEPATH_V5; // Default V5 path

		// Setup for split-screen secondary image
		if(opts.secondaryTo) {
			this.opacity = 0; // Start invisible
			// Default placement based on orientation
			opts.area = this.wasm.micrio.canvas.viewport.portrait ? [0,1,1,1] : [1,0,1,1];
			if(opts.isPassive === undefined) opts.isPassive = true; // Default to passive following
		}
		// Default area if not provided
		else if(!opts.area) opts.area = [0,0,1,1];

		// Check for predefined local data
		this.preset = getLocalData(this.id);

		// Setup readable store for image info, loading data asynchronously
		let infoLoaded:boolean = false;
		this.info = readable<Models.ImageInfo.ImageInfo|undefined>(undefined, set => {
			infoLoaded ? set(this.__info) : this.load().then(set); infoLoaded=!0;
		});

		const micrio = this.wasm.micrio; // Reference to main element

		// Check if data was provided directly (e.g., V5 revision data)
		const hasData = !!this.attr.revision;

		// Subscribe to visibility changes
		let wasVis:boolean=get(this.visible);
		let followUnsub:Unsubscriber|null;
		if(!opts.isEmbed || hasData) this.visible.subscribe(v => {
			if(v==wasVis) return; wasVis=v; // Ignore if visibility hasn't changed

			// Load cultural data when becoming visible if not already loaded
			if(v && !this._loadedData) {
				if(!hasData && this.isV5) { // V5 loads data later based on language
					this._loadedData = true;
					this.data.set(undefined);
				}
				else this.loadData(); // Load data immediately for V4 or if revision provided
			}

			// Handle split-screen logic on visibility change
			if(opts.secondaryTo) {
				if(opts.isPassive) { // Manage passive following subscription
					if(followUnsub) { followUnsub(); followUnsub = null; } // Unsubscribe if becoming hidden
					else if(v) followUnsub = opts.secondaryTo.state.view.subscribe(v => { // Subscribe if becoming visible
						if(v && !this.camera.aniDone) this.camera.setView(v, {noLimit: true}) // Follow view if not animating
					});
				}
				// Dispatch split-screen events
				if(v) micrio.events.dispatch('splitscreen-start', this);
				else micrio.events.dispatch('splitscreen-stop', this);
			}
			// Update the global visible canvases list
			micrio.visible.update(l => {
				if(v) l.push(this);
				else l.splice(l.indexOf(this), 1);
				return l;
			});
			// If this image became visible and is the main current image, clear switching state
			if(v && micrio.$current == this) micrio.switching.set(false);
		});

		// Keep internal video reference synced
		this.video.subscribe(v => this._video = v);

		// Sanitize marker/embed data whenever the data store updates
		this.data.subscribe(d => {if(d)sanitizeImageData(d, this.isV5, isLegacyViews(this.__info))});
	}

	/** Sets the error state and prints it to the UI.
	 * @internal
	 */
	private setError(e:Error, err?:string) {
		this.wasm.micrio.printError(this.error = err??e?.message??e?.toString()??'An unknown error has occurred');
		this.wasm.micrio.loading.set(false); // Stop loading indicator
		throw e; // Re-throw error
	}

	/**
	 * Loads the image's core information (`info.json` or IIIF manifest).
	 * Merges attribute settings and preset data. Calculates derived properties.
	 * Handles IIIF sequence parsing and space data loading.
	 * @internal
	 * @returns Promise resolving to the loaded and processed ImageInfo object.
	*/
	private async load() : Promise<Models.ImageInfo.ImageInfo> {
		let i = this.__info; // Internal info object reference
		const attr = this.attr; // Initial attributes/info passed to constructor
		const micrio = this.wasm.micrio;

		// Use provided object directly if it seems complete
		if(attr.id && attr.width) {
			if(attr.settings) deepCopy(DEFAULT_INFO.settings, attr.settings, {noOverwrite: true}); // Merge default settings
			this.__info = i = attr as Models.ImageInfo.ImageInfo;
		}

		let iiifManifest = i.iiifManifest||attr.iiifManifest; // Check for IIIF manifest URL

		// Determine if IIIF based on URL or format property
		i.isIIIF = this.id.startsWith('http') || i.format == 'iiif';

		const forceDataRefresh = !!attr.settings?.forceDataRefresh;
		// Fetch info/manifest if ID provided but dimensions missing, or if IIIF
		if(this.id && (!attr.width || !attr.height || iiifManifest)) {
			const loadError = (e:Error) => this.setError(e, 'Image with id "'+this.id+'" not found, published, or embeddable.');
			// Fetch info (Micrio or IIIF) or use preset data
			deepCopy(this.preset?.[1] || await (i.isIIIF ? fetchJson(this.id) : fetchInfo(this.id, this.infoBasePath, forceDataRefresh)).catch(loadError), i);
			// Re-check for manifest URL after fetching info
			if(!iiifManifest && i.iiifManifest) iiifManifest = i.iiifManifest;
			if(!i.isIIIF) i.isIIIF = !!iiifManifest;
			// Fetch and merge IIIF manifest if present
			if(iiifManifest) deepCopy(await fetchJson(iiifManifest).catch(loadError), i);
			// Apply meta settings
			if(!!i.settings?._meta?.['noLogo']) i.settings.noLogo = true;
			if(!!i.settings?._meta?.['noSmoothing']) i.settings.noSmoothing = true;
		}
		// Use preset info if available and not fetched
		else if(this.preset?.[1]) deepCopy(this.preset[1], i);

		// Sanitize IIIF ID prefix
		const iiifIdBase = 'https://iiif.micr.io/';
		if(i.id.startsWith(iiifIdBase)) i.id = i.id.slice(iiifIdBase.length)

		// Decode metadata from short V4 IDs (length 7)
		if(this.id?.length == 7) {
			const b = getIdVal(this.id[1+(getIdVal(this.id)%6)]); i.is360=!!((b>>4)&1); i.isWebP=!(b&3); i.isPng=(b&3)==2;
			if((b>>3)&1 && idIsV5(i.tilesId??this.id)) i.format='dz'; if(!i.path) i.path = `https://${!((b>>2)&1)?'r2':'eu'}.micr.io/`;
		}

		// Handle V5 imported images (ID starts with 'i', length 6)
		const isV5Imported = this.isV5 && this.id.startsWith('i') && !this.id.includes('/');
		if(isV5Imported && !i.tilesId) i.tilesId = this.id.slice(1); // Use ID without 'i' as tilesId
		const isDemo = DEMO_IDS.indexOf(i.id) >= 0 || i.tilesId && DEMO_IDS.indexOf(i.tilesId) >= 0;

		// Merge attribute settings again (overriding fetched info)
		deepCopy(attr, i);

		// Determine tile base path
		const isExternal = isV5Imported && !i.tileBasePath?.includes('micr.io');
		this.tileBase = isExternal ? i.tileBasePath ?? BASEPATH : (isDemo || isV5Imported) ? BASEPATH : i.tileBasePath ?? i.path ?? (this.isV5 ? BASEPATH_V5 : BASEPATH);
		// Use organization base URL if provided and path wasn't forced by attribute
		if(i.organisation?.baseUrl && !attr.path) {
			this.dataPath = i.path = i.organisation.baseUrl;
			if(!isV5Imported || isDemo) this.tileBase = this.dataPath;
		}
		// Handle EU path explicitly
		else if(i.path == BASEPATH_V5_EU) this.dataPath = i.path;

		// Handle Omni object setup (load base archive, configure gallery settings)
		if(i.settings?.omni) {
			this.isOmni = true;
			if(parseFloat(i.version) >= 5) { // V5 Omni requires base archive
				await archive.load(this.tileBase??this.dataPath, (i.tilesId??i.id)+'/base', loadingProgress => micrio._ui?.setProps?.({loadingProgress}))
					.catch(e => this.setError(e, 'Could not find object base package.'));
				// Configure gallery settings for Omni
				if(!i.settings.gallery) i.settings.gallery = {};
				i.settings.gallery.type = 'omni';
				i.settings.gallery.archive = i.id; // Use image ID as archive key for gallery logic
			}
		}

		// Load organization branding CSS if present
		if(i.organisation?.branding && !(i.settings && i.settings.noUI)) {
			this.loadStyle(this.dataPath+'style/'+i.organisation.slug+'.css').then(() => {
				// Check if custom font needs loading from Google Fonts
				const fontFamily = getComputedStyle(this.wasm.micrio).getPropertyValue('--micrio-font-family')?.replace(/^'([^']+)'.*$/,'$1');
				if(fontFamily) document.fonts.ready.then(() => { if(!document.fonts.check('16px ' + fontFamily))
					this.loadStyle(`https://fonts.googleapis.com/css2?family=${fontFamily}:ital,wght@0,300;0,400;0,500;0,600;0,800;1,300;1,400;1,500;1,600;1,800&display=swap`)
				});
			});
		}

		// Parse IIIF sequence data if present
		if(i.isIIIF) {
			if(i.sequences && i.sequences.length) this.parseIIIFSequence(i, !!iiifManifest);
			else { // Extract ID/path if not a sequence
				const id:string = (iiifManifest || ('@id' in i ? i['@id'] : i.id) as string).replace('/info.json', '');
				i.path = id.replace(/\/[^/]*$/,'');
				i.id = id.replace(/^.*\/([^/]*)$/,'$1');
			}
		}

		// Load 360 space data if linked and not already loaded
		if(i.spacesId && !micrio.spaceData) {
			micrio.spaceData = 'MICRIO_SPACE_DATA' in self ? self['MICRIO_SPACE_DATA'] as Models.Spaces.Space // Check for preloaded data
				: await fetchJson<Models.Spaces.Space>('https://i.micr.io/spaces/'+i.spacesId+'.json'); // Fetch from CDN
		}

		// Set trueNorth for 360 images based on space data rotation
		if(i.settings?._360) {
			let rotY = micrio.spaceData?.images.find(img => img.id == this.id)?.rotationY??0;
			while(rotY < 0) rotY += Math.PI * 2;
			i.settings._360.trueNorth = (.5 + rotY / Math.PI / 2)%1;
		}

		// Set derived flags and properties
		this.noImage = this.noImage || this.isOmni || (!i.id && !i.tilesId); // Mark as noImage if Omni or no tile source
		this.extension = i.tileExtension || i.isPng && 'png' || i.isWebP && 'webp' || 'jpg'; // Determine tile extension
		if(i.format == 'dz') i.isDeepZoom = true; // Set deep zoom flag
		this.is360 = !!i.is360;
		this.isVideo = !!i.isVideo;

		// Determine initial language
		let lang:string|undefined=this.isV5 ? get(micrio._lang) : (!('cultures' in i) ? attr.lang : undefined) ?? undefined;

		// Set available cultures and determine active language for V4
		if(!this.isV5) {
			if(!i.settings?.skipMeta && 'cultures' in i) {
				const c = (i.cultures as string || '').split(',');
				const isChild = this.opts.isEmbed || !!this.opts.area;
				const forceLang = i.settings?.onlyPreferredLang || isChild;
				lang = i.lang && c.indexOf(i.lang) >= 0 ? i.lang : forceLang ? undefined : c[0]; // Use specified lang, forced lang, or first available
				if(lang && !isChild) micrio.lang = lang; // Set global language if determined
			}
		} else if(i.revision) { // V5 language handling based on revisions
			const langs = Object.keys(i.revision);
			// If current global lang isn't available for this image, switch to the first available
			if(langs.length && langs.indexOf(lang as string) < 0)
				micrio.lang = langs[0];
		}

		// Load custom JS/CSS (legacy)
		const s = i.settings;
		if(s && !s?.noExternals) await Promise.all([
			s.css ? this.loadStyle(s.css.href) : null,
			s.js ? this.loadScript(s.js.href, lang) : null
		].filter(p=>!!p));

		// Calculate zoom levels
		for(let f=i.tileSize; f < Math.max(i.width,i.height); f *= 2, this.levels++) {}
		let max = Math.max(i.width, i.height); do this.dzLevels++; while((max/=2) > 1); // Calculate DeepZoom levels
		if(s?.gallery?.archive) this.levels -= 1 - (s.gallery.archiveLayerOffset ?? 0); // Adjust levels based on archive offset
		if(!this.noImage) this.thumbSrc = this.getTileSrc(this.levels, 0, 0); // Generate thumbnail URL

		// Dispatch pre-info event for external manipulation
		micrio.events.dispatch('pre-info', i);

		// Load V5 data immediately if revision info is present and not an embed
		if(this.isV5 && i.revision != undefined && !this.opts.isEmbed)
			await this.loadData();

		// Subscribe to language changes for V4 data loading
		else if(!i.settings?.skipMeta && !this.opts.isEmbed && !this.isV5) micrio._lang.subscribe((lang?:string) => {
			// Validate language against available cultures
			if(lang && this.id && (!('cultures' in this.__info) || (this.__info.cultures as string || '').split(',').indexOf(lang) < 0)) lang = undefined;
			this.data.set(undefined); // Clear existing data
			if(!lang && this.preset?.[2]) lang = 'preset'; // Use preset if no valid lang
			if((lang) && this.id) {
				if(this.preset?.[2]) this.enrichData(this.preset[2]) // Use preset data if available
					.then(d => { this.data.set(d); if(this.preset?.[2]) this.preset[2] = undefined; }); // Clear preset after use
				else fetchJson<Models.ImageData.ImageData>(this.dataPath+this.id+'/data.'+lang+'.json') // Fetch data for language
					.catch(() => {}).then((d) => d && this.enrichData(d).then(nd => this.data.update(d => { // Enrich and merge data
						deepCopy(nd, d ? d : (d={}), {mergeArrays: true});
						return d;
					})));
			}
		});

		// Handle linked split-screen setup
		if(i.settings?.micrioSplitLink && !this.opts.secondaryTo) {
			micrio.open({ // Open the linked image
				id: i.settings.micrioSplitLink,
				settings: { hookEvents: i.settings.secondaryInteractive !== false }
			}, { // As a split-screen secondary image
				splitScreen: true,
				isPassive: !i.settings.noFollow // Follow main view unless disabled
			})
		}

		// Set final settings store value (after merging everything)
		if(i.settings) this.settings.set(i.settings);
		delete i.settings; // Remove settings from info object after processing

		// Hook Omni controls if applicable
		if(this.isOmni) this.state.hookOmni();

		return i; // Return the processed info object
	}

	/** Flag indicating if cultural data has been loaded. @internal */
	_loadedData:boolean = false;
	/**
	 * Loads the cultural data (`data.[lang].json` or `pub.json`) for the image.
	 * @internal
	*/
	private async loadData() : Promise<void> {
		const skipMeta = this.$settings?.skipMeta || this.__info.settings?.skipMeta;
		if(this._loadedData || skipMeta) return Promise.resolve(); // Don't reload if already loaded or skipped
		this._loadedData = true;
		// Get data from preset or fetch V5 public data
		const data = this.preset?.[2] ?? (this.isV5 && await fetchJson<Models.ImageData.ImageData>(this.dataPath+this.id+'/data/pub.json',this.__info.settings?.forceDataRefresh).catch(() => {}));
		if(data) this.enrichData(data).then(d => this.data.set(d)); // Enrich and set data store
	}

	/**
	 * Generates the source URL for a specific image tile.
	 * Handles different formats (standard, DeepZoom, IIIF) and frame numbers (for Omni).
	 * @internal
	 * @param layer The zoom level index.
	 * @param x The tile X coordinate.
	 * @param y The tile Y coordinate.
	 * @param frame Optional frame number for Omni objects.
	 * @returns The calculated tile image source URL string, or undefined if info not loaded.
	 */
	getTileSrc(layer:number, x:number, y:number, frame?:number) : string|undefined {
		const i = this.__info;
		if(!i) return; // Exit if info not loaded

		// Adjust layer index for DeepZoom format
		if(i.isDeepZoom) layer = this.dzLevels - layer;

		// Handle IIIF URL generation
		if(i.isIIIF) {
			const s = i.tileSize; // Tile size
			const ts = Math.pow(2, layer) * s; // Size of the tile at this layer in image pixels
			// Calculate region coordinates, clamping to image boundaries
			const left = Math.min(i.width, x * ts);
			const top = Math.min(i.height, y * ts);
			const regionW = Math.min(i.width-left, ts);
			const regionH = Math.min(i.height-top, ts);
			// Calculate requested size, clamping to tile size
			const sizeW = Math.round(Math.min(s, regionW / ts * s));
			const sizeH = Math.round(Math.min(s, regionH / ts * s));
			// Construct IIIF Image API URL
			return `${i.path}/${i.id}/${[left,top,regionW,regionH].join(',')}/${[sizeW,sizeH].join(',')}/0/default.jpg`;
		}

		// Throw error if trying to get tile for a video (shouldn't happen)
		if(i.settings?._360?.video?.src)
			throw 'Video thumb';

		// Construct standard Micrio tile URL
		return `${this.tileBase}${i.tilesId||i.id}/${frame !== undefined ? frame + '/' : ''}${layer}/${x}${i.isDeepZoom?'_':'-'}${y}.${this.extension}`;
	}

	/** Loads an external script dynamically. Ensures scripts are loaded only once.
	 * @internal
	 */
	private loadScript(s:string, lang:string='') : Promise<void> { return new Promise((ok:() => void) => {
		if(jsCss.indexOf(s) >= 0 || document.querySelector('script[src="'+s+'"]')) ok(); // Already loaded
		else { jsCss.push(s); // Mark as loading
			const _el = document.createElement('script'); _el.type = 'text/javascript';
			_el.async = true; _el.defer = true;
			/** @ts-ignore -- used for custom JS to have a cool self reference */
			_el['micrioElement'] = this.wasm.micrio; // Pass Micrio element reference
			_el.src = s.replace('$lang', lang); _el.onload = ok; document.head.appendChild(_el);
		}
	})}

	/** Loads an external stylesheet dynamically. Ensures stylesheets are loaded only once.
	 * @internal
	 */
	private loadStyle(s:string) : Promise<void> { return new Promise((ok:() => void) => {
		if(jsCss.indexOf(s) >= 0 || document.head.querySelector('link[href="'+s+'"]')) ok(); // Already loaded
		else { jsCss.push(s); // Mark as loading
			const _el = document.createElement('link'); _el.setAttribute('type', 'text/css');
			_el.setAttribute('rel', 'stylesheet'); _el.setAttribute('href', s);
			_el.onload = ok; document.head.appendChild(_el);
		}
	})}

	/**
	 * Enriches cultural data after loading.
	 * Currently focuses on loading and processing serial marker tour data.
	 * Preloads linked image info and data for smoother tour transitions.
	 * Dispatches 'pre-data' event allowing external modification.
	 * @internal
	 * @param d The raw image data object.
	 * @returns Promise resolving to the enriched image data object.
	*/
	private async enrichData(d:Models.ImageData.ImageData) : Promise<Models.ImageData.ImageData> {
		if(!d) return d; // Return if no data
		/** @ts-ignore Check for error property */
		if('error' in d) this.__info.error = (d['status'] as string) == '403' ? 'Could not load image data. Are you logged in and do you have the right credentials?' : (d['error'] as string);

		const lang = this.wasm.micrio.lang; // Current language

		const micIds:string[] = [] // Array to store IDs of linked Micrio images

		// Process markers
		d.markers?.forEach(m => {
			sanitizeMarker(m, !this.isV5, isLegacyViews(this.__info)); // Sanitize marker data

			// Check for split-screen links in marker data
			if(m.data?.micrioSplitLink) {
				const split = m.data.micrioSplitLink.split(',').map(s => s.trim());
				const l = m.data._micrioSplitLink = { // Store parsed link data
					micrioId: split[0],
					markerId: split[1],
					follows: !!split[2] && split[2] != 'false'
				};
				if(l.markerId) micIds.push(l.micrioId); // Add linked image ID for preloading
			}
		})

		// Collect linked image IDs from marker tours
		if(d.markerTours?.length) micIds.push(...[].concat.apply([],
			/** @ts-ignore */
			d.markerTours.map(t => t.steps)).map((s:string) => s.split(',')[1]).filter((s:string) => !!s && s != this.id) // Extract linked IDs from steps
		);

		// Handle legacy autostart tours
		const hasV4AutoStart = (t:Models.ImageData.MarkerTour|Models.ImageData.Tour) => 'autostart' in t && t.autostart
		const autostartTour = d.markerTours?.find(hasV4AutoStart) || d.tours?.find(hasV4AutoStart);
		if(autostartTour) this.$settings.start = { // Set start setting if autostart found
			type: 'steps' in autostartTour ? 'markerTour' : 'tour',
			id: autostartTour.id
		};

		// Preload info for unique linked IDs (don't wait)
		const micIdsUnique:string[] = micIds.filter((id,i) => micIds.indexOf(id)==i);
		Promise.all(micIdsUnique.map(id => fetchInfo(id, this.infoBasePath)));

		// Helper function to get data path for a given ID
		const getDataPath = (id:string) : string =>
			this.dataPath+(!this.isV5 ? id+'/data.'+lang+'.json' : id+'/data/pub.json');

		// Preload data for unique linked IDs
		const micData = await Promise.all(micIdsUnique.map(
			id => fetchJson<Models.ImageData.ImageData>(getDataPath(id))));

		// Sanitize markers in preloaded data
		micData.forEach((d,i) => d?.markers?.forEach(m => sanitizeMarker(m, micIdsUnique[i]!.length == 5, isLegacyViews(this.__info))));

		const spaceData = this.wasm.micrio.spaceData; // Get space data if available

		// Load detailed step info for marker tours
		if(d.markerTours) {
			await Promise.all(d.markerTours.map(t => loadSerialTour(this, t, lang, d)));

			// Filter out serial tours if space data exists (they are handled differently in spaces)
			if(spaceData) d.markerTours = d.markerTours.filter(t => !t.steps.find(s => s.includes(',')));
		}

		// Load step info for space-defined marker tours
		if(spaceData?.markerTours) await Promise.all(spaceData.markerTours.filter(t => !t.stepInfo).map(t => loadSerialTour(this, t, lang, d)));

		// Add target marker view data to split link markers
		d.markers?.forEach(m => {
			if(!m.data?._micrioSplitLink) return;
			const targetId = m.data?._micrioSplitLink?.markerId;
			if(targetId) for(let i=0;i<micData.length;i++) { // Search preloaded data
				const target = micData[i]?.markers?.find(sm => sm.id == targetId);
				if(target) {
					m.data._micrioSplitLink.view = target.view; // Store target view
					return;
				}
			}
		});

		// Dispatch pre-data event allowing external modification of all loaded data
		this.wasm.micrio.events.dispatch('pre-data', {
			[this.id]: d, // Current image data
			...Object.fromEntries(micIdsUnique.map((id,i) => [id, micData[i]!])) // Preloaded linked data
		});

		// If linked images were already initialized but lacked data, set it now
		micData.forEach((data,i) => { if(data) {
			const image = this.wasm.images.find(m => m.id == micIdsUnique[i]);
			if(image && image instanceof MicrioImage && !image.$data && !isFetching(getDataPath(image.id)))
				image.data.set(data); // Set data store for the linked image
		}});

		return d; // Return the enriched data
	}

	/** Parses IIIF sequence data to create embedded MicrioImage instances for each canvas.
	 * @internal
	 */
	private parseIIIFSequence(i:Models.ImageInfo.ImageInfo, isIIIFSequence:boolean=false) : void {
		const s = i.sequences?.[0]; // Get first sequence
		if(!s) return;
		const vertical = s.viewingDirection == 'top-to-bottom'; // Check viewing direction
		// Extract image resources from canvases
		const images = s.canvases.map(c => c.images[0]).map(i => i.resource);
		this.noImage = true; // Mark main image as virtual
		// Calculate overall dimensions
		i.width = !vertical ? images.reduce((v, i) => v+i.width, 0) : Math.max(...images.map(i => i.width));
		i.height = vertical ? images.reduce((v, i) => v+i.height, 0) : Math.max(...images.map(i => i.height));
		let offset = 0; // Running offset for placement
		let canvas = this.embeds; // Target array for image instances
		// If many images in sequence, treat as gallery instead of embeds
		if(!i.settings) i.settings = {};
		if(isIIIFSequence && images.length > 10) {
			canvas = i.gallery = []; // Use gallery array
			if(!i.settings.gallery) i.settings.gallery = {}; // Ensure gallery settings exist
		}
		// Create MicrioImage instance for each canvas/image
		images.forEach(s => {
			// Calculate margins for centering
			const margins = [ (1 - (s.width / i.width)) / 2, (1 - (s.height / i.height)) / 2 ];
			// Create new MicrioImage instance
			canvas.push(new MicrioImage(this.wasm, {
				id: s.service['@id'], // Use IIIF service ID
				width: s.width, height: s.height,
				isPng: s.format == 'image/png',
				settings: {} // Basic settings
			}, { // Embed options
				// Calculate placement area based on direction and offset
				area: vertical ? [margins[0], offset/i.height, 1-margins[0], (offset+s.height)/i.height]
					: [offset/i.width, margins[1], (offset+s.width)/i.width, 1-margins[1] ]
			}));
			offset+=vertical?s.height:s.width; // Update offset
		});
	}

	/**
	 * Adds an embedded MicrioImage (representing another Micrio image or video) within this image.
	 * @param info Partial info data for the embed.
	 * @param area The placement area `[x0, y0, x1, y1]` within the parent image.
	 * @param opts Embedding options (opacity, fit, etc.).
	 * @returns The newly created embedded {@link MicrioImage} instance.
	 */
	addEmbed(info:Partial<Models.ImageInfo.ImageInfo>, area:Models.Camera.ViewRect, opts:Models.Embeds.EmbedOptions = {}) : MicrioImage {
		const a = area.slice(0); // Clone area array
		// Create new MicrioImage instance for the embed
		const img = new MicrioImage(this.wasm, info, {area:a, isEmbed: true, useParentCamera: opts.asImage});
		// Use parent camera if specified (e.g., for switch galleries)
		if(!img.camera) img.camera = this.camera;
		this.embeds.push(img); // Add to embeds list
		if(opts.opacity === undefined) opts.opacity = 1; // Default opacity

		// Once the embed's info is loaded
		once(img.info).then((i) => { if(!i) return;
			// Adjust area based on 'fit' option (cover or contain)
			if(opts.fit == 'cover' || opts.fit == 'contain') {
				const yS = this.is360 ? 2 : 1; // Y-scale factor for 360
				const isCover = opts.fit == 'cover';
				const aW = a[2]-a[0], aH = a[3] - a[1], cX = a[0] + aW/2, cY = a[1] + aH/2; // Area dimensions/center
				const aAr = aW / aH * yS; // Area aspect ratio
				const imgAr = i.width / i.height; // Image aspect ratio
				// Adjust area dimensions based on aspect ratios and fit mode
				if((isCover && imgAr < aAr) || (!isCover && imgAr >= aAr)) { // Adjust height
					const nH = aW / imgAr * yS; a[1] = cY - nH/2; a[3] = cY + nH/2;
				} else { // Adjust width
					const nW = aH * imgAr / yS; a[0] = cX - nW/2; a[2] = cX + nW/2;
				}
			}
			// Add the embed to the WebAssembly controller
			this.wasm.addEmbed(img, this, opts);
			this.wasm.render(); // Trigger render
		});
		return img; // Return the new embed instance
	}

	/** Map storing references to HTMLMediaElements associated with video embeds. @internal */
	private embedElements:Map<string, HTMLMediaElement> = new Map();

	/** Sets the HTMLMediaElement reference for a given embed ID. @internal */
	setEmbedMediaElement(id:string, el?:HTMLMediaElement) : void {
		if(el) this.embedElements.set(id, el);
		else this.embedElements.delete(id);
	}

	/** Gets the HTMLMediaElement associated with a video embed ID. */
	getEmbedMediaElement(id:string) : HTMLMediaElement|undefined {
		return this.embedElements.get(id);
	}

	/** Starts the split-screen transition animation for this (secondary) image. @internal */
	splitStart() : void {
		const p = this.wasm.micrio.canvas.viewport.portrait; // Check orientation
		// Set area for primary image (left/top half)
		this.opts.secondaryTo?.camera.setArea(p ? [0,0,1,.5] : [0,0,.5,1], {noRender:true});
		// Set area for this secondary image (right/bottom half)
		this.camera.setArea(p ? [0,.5,1,1] : [.5,0,1,1], {noRender:true});
		// Set initial view for this image
		this.camera.setView(this.__info?.settings?.view ?? [0,0,1,1])
		this.wasm.render(); // Trigger render
	}

	/** Ends the split-screen transition animation for this (secondary) image. @internal */
	splitEnd() : void {
		const a = this.opts.area; // Get current area
		if(!a) return;
		const w = a[2]-a[0], h = a[3]-a[1];
		// Exit if area is already collapsed (prevent multiple calls)
		if(Math.round(w * 1000)/1000 == 0 || Math.round(h * 1000)/1000 == 0) return;
		const p = w > h; // Determine direction to collapse based on aspect ratio
		// Animate this image's area to collapse off-screen
		this.camera.setArea(p ? [0,1,1,1] : [1,0,1,1], {noRender:true});
		// If primary image is not animating (or not part of grid), reset its area to full
		if(!this.opts.secondaryTo?.grid || !this.opts.secondaryTo.camera.aniDone)
			this.opts.secondaryTo?.camera.setArea([0,0,1,1], {noRender:true});
		this.wasm.render(); // Trigger render
	}

	/** Fades in the image smoothly or instantly. */
	fadeIn(direct:boolean=false) : void {
		this.wasm.fadeImage(this.ptr, 1, direct); // Call Wasm function
		this.wasm.render();
	}

	/** Fades out the image smoothly or instantly. */
	fadeOut(direct:boolean=false) : void {
		this.wasm.fadeImage(this.ptr, 0, direct); // Call Wasm function
		this.wasm.render();
	}

}
