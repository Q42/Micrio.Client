import type { Models } from '$types/models';
import type { Readable, Unsubscriber, Writable } from 'svelte/store';
import type { Grid } from './nav/grid';
import type { Engine } from './render/engine';
import type { GallerySwiper } from './nav/swiper';
import type { HTMLMicrioElement } from './element'; // Import HTMLMicrioElement type

import { BASEPATH, BASEPATH_V5, BASEPATH_V5_EU, DEFAULT_INFO, VIEWER_BASE } from './globals';
import { Camera } from './camera';
import { readable, writable, get } from 'svelte/store';
import { Sanitizer } from './utils/sanitize';
import { clone, deepCopy } from './utils/object';
import { createGUID } from './utils/string';
import { fetchJson } from './utils/fetch';
import { once } from './utils/store';
import { MicrioError } from './utils/error';
import { DataLoader } from './utils/dataLoader';
import { State } from './state';
import { archive } from './render/archive';

/** Keep track of already loaded scripts-- only do this once per session
 * @private
*/
const jsCss:string[] = [];

/**
 * Represents and controls a single Micrio image instance within the viewer.
 * This class manages the image's metadata (info), cultural data (data),
 * settings, camera, state, and interactions with the compute engine
 * for rendering and processing. It handles loading image tiles, embeds,
 * markers, tours, and galleries associated with the image.
 *
 * Instances are typically created and managed by the main {@link HTMLMicrioElement}.
 * @author Marcel Duin <marcel@micr.io>
*/
export class MicrioImage {
	/** The unique identifier (Micrio ID) for this image. */
	id: string;

	/** A unique instance identifier (UUID) generated for this specific instance. */
	readonly uuid: string = createGUID();

	/** Internal storage for the image info data.
	 * @internal
	 * @readonly
	*/
	private __info:Models.ImageInfo.ImageInfo = clone(DEFAULT_INFO);

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

	/** Pointer to the image instance within the compute engine.
	 * @readonly
	 * @internal
	*/
	ptr: number = -1;

	/** Base tile index within the engine texture atlas.
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

	/** Array of child {@link MicrioImage} instances embedded within this image. */
	readonly embeds: MicrioImage[] = [];

	/** Grid controller instance, if this image is a grid container. */
	public grid: Grid|undefined;

	/** Base path for fetching image tiles. */
	tileBase:string|undefined;

	/**
	 * Creates a new MicrioImage instance. Typically called by {@link HTMLMicrioElement.open}.
	 * @internal
	 * @param engine The global Engine controller instance.
	 * @param attr Initial image info/settings, often from HTML attributes or parent data.
	 * @param opts Options controlling behavior (embedding, split-screen, etc.).
	 */
	constructor(
		public engine: Engine,
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

		this.id = (attr.id??'').replace(VIEWER_BASE,''); // Sanitize ID

		// URL-encode the custom-id part for external IDs (`external/{org-slug}/{custom-id}`)
		if(this.id.startsWith('external/')) {
			const secondSlash = this.id.indexOf('/', this.id.indexOf('/') + 1);
			if(secondSlash !== -1)
				this.id = this.id.substring(0, secondSlash + 1) + encodeURIComponent(this.id.substring(secondSlash + 1));
		}
		// Determine base paths for info and data JSON
		this.infoBasePath = attr.path && attr.forceInfoPath ? attr.path : undefined;
		this.dataPath = attr.path||this.__info.path||BASEPATH_V5;

		// Setup for split-screen secondary image
		if(opts.secondaryTo) {
			this.opacity = 0; // Start invisible
			// Default placement based on orientation
			opts.area = this.engine.micrio.canvas.viewport.portrait ? [0,1,1,1] : [1,0,1,1];
			if(opts.isPassive === undefined) opts.isPassive = true; // Default to passive following
		}
		// Default area if not provided
		else if(!opts.area) opts.area = [0,0,1,1];

		// Setup readable store for image info, loading data asynchronously
		let infoLoaded:boolean = false;
		this.info = readable<Models.ImageInfo.ImageInfo|undefined>(undefined, set => {
			infoLoaded ? set(this.__info) : this.load().then(set); infoLoaded=!0;
		});

		const micrio = this.engine.micrio; // Reference to main element

		// Check if data was provided directly (e.g., V5 revision data)
		const hasData = !!this.attr.revision;

		// Subscribe to visibility changes
		let wasVis:boolean=get(this.visible);
		let followUnsub:Unsubscriber|null;
		if(!opts.isEmbed || hasData) this.visible.subscribe(v => {
			if(v==wasVis) return; wasVis=v; // Ignore if visibility hasn't changed

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

	}

	/**
	 * Sets the error state and prints it to the UI.
	 * @internal
	 * @param e The original error (MicrioError, Error, or string)
	 * @param displayMessage Optional user-friendly message to display
	 */
	private setError(e: Error | string, displayMessage?: string): never {
		// Use MicrioError's displayMessage if available, otherwise fall back
		const message = e instanceof MicrioError 
			? e.displayMessage 
			: (displayMessage ?? (e instanceof Error ? e.message : e) ?? 'An unknown error has occurred');
		this.error = message;
		this.engine.micrio.printError(e instanceof MicrioError ? e : message);
		this.engine.micrio.loading.set(false); // Stop loading indicator
		throw e instanceof Error ? e : new Error(message);
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
		const micrio = this.engine.micrio;

		// Use provided object directly if it seems complete
		if(attr.id && attr.width) {
			if(attr.settings) deepCopy(DEFAULT_INFO.settings, attr.settings, {noOverwrite: true}); // Merge default settings
			this.__info = i = attr as Models.ImageInfo.ImageInfo;
		}

		let iiifManifest = i.iiifManifest||attr.iiifManifest; // Check for IIIF manifest URL

		// Determine if IIIF based on URL or format property
		i.isIIIF = this.id.startsWith('http') || i.format == 'iiif';

		let idFromCustomId:string|undefined;
		// Fetch info/manifest if ID provided but dimensions missing, or if IIIF
		if(this.id && (!attr.width || !attr.height || iiifManifest)) {
			const loadError = (e:Error) => this.setError(e, typeof e == 'string' ? e : 'Image with id "'+this.id+'" not found, published, or embeddable.');
			// Fetch info (Micrio or IIIF) or use preset data
			deepCopy(await (i.isIIIF ? fetchJson(this.id) : DataLoader.getInfo(this.id)
				.then(r => {
					// If custom ID requested (`id="external/{org-slug}/{customId}"`), the returned info is redirected to real image's ID path.
					// Also correct this internally.
					if(r?.id && !i.isIIIF && this.id.split('/').length>=3 && this.id.startsWith('external/')) {
						idFromCustomId = r.id.split('/').reverse()[0];
						this.dataPath = r.path || BASEPATH_V5;
					}
					return r;
				})
			).catch(loadError), i);
			// Re-check for manifest URL after fetching info
			if(!iiifManifest && i.iiifManifest) iiifManifest = i.iiifManifest;
			if(!i.isIIIF) i.isIIIF = !!iiifManifest;
			// Fetch and merge IIIF manifest if present
			if(iiifManifest) deepCopy(await fetchJson(iiifManifest).catch(loadError), i);
		}
		const { isV5Imported } = Sanitizer.imageId(i, this.id);

		// Merge attribute settings again (overriding fetched info)
		deepCopy(attr, i);

		// Overwrite internal Micrio ID with original Micrio ID
		if(idFromCustomId) this.id = i.id = idFromCustomId;

		// Determine tile base path
		// V5 imported images always tile from the legacy CDN (b.micr.io)
		const isExternal = isV5Imported && !i.tileBasePath?.includes('micr.io');
		this.tileBase = isExternal ? i.tileBasePath ?? BASEPATH : isV5Imported ? BASEPATH : i.tileBasePath ?? i.path ?? BASEPATH_V5;
		// Use organization base URL if provided and path wasn't forced by attribute
		const org = DataLoader.getOrganisation();
		if(org?.baseUrl && !attr.path) {
			this.dataPath = i.path = org.baseUrl;
			if(!isV5Imported) this.tileBase = this.dataPath;
		}
		// Handle EU path explicitly
		else if(i.path == BASEPATH_V5_EU) this.dataPath = i.path;
		// Use path from fetched info as dataPath for all other cases
		else if(i.path) this.dataPath = i.path;

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
		if(org?.branding && !(i.settings && i.settings.noUI)) {
			this.loadStyle(this.dataPath+'style/'+org.slug+'.css').then(() => {
				// Check if custom font needs loading from Google Fonts
				const fontFamily = getComputedStyle(this.engine.micrio).getPropertyValue('--micrio-font-family')?.replace(/^'([^']+)'.*$/,'$1');
				if(fontFamily) document.fonts.ready.then(() => { if(!document.fonts.check('16px ' + fontFamily))
					this.loadStyle(`https://fonts.googleapis.com/css2?family=${fontFamily}:ital,wght@0,300;0,400;0,500;0,600;0,800;1,300;1,400;1,500;1,600;1,800&display=swap`)
				});
			});
		}

		// Parse IIIF sequence data if present
		if(i.isIIIF) {
			if(i.sequences && i.sequences.length) this.parseIIIFSequenceV2(i, !!iiifManifest);
			else if(i.type == 'Manifest') this.parseIIIFSequenceV3(i);
			else { // Extract ID/path if not a sequence
				const id:string = (iiifManifest || ('@id' in i ? i['@id'] : i.id) as string).replace('/info.json', '');
				i.path = id.replace(/\/[^/]*$/,'');
				i.id = id.replace(/^.*\/([^/]*)$/,'$1');
			}
		}

		// Load 360 space data from bundle if linked and not already loaded
		if(i.spacesId && !micrio.spaceData) {
			micrio.spaceData = DataLoader.getSpaceData(i.spacesId);
			if(micrio.spaceData?.images.length == 1) delete micrio.spaceData;
		}

		// Resolve 360 Y rotation: prefer space data, fall back to legacy _360.trueNorth
		if(i.is360 && this.camera) {
			const spaceRotY = micrio.spaceData?.images.find(img => img.id == this.id)?.rotationY;
			if(spaceRotY != null) this.camera.rotationY = spaceRotY;
			else if(i.settings?._360?.trueNorth != null)
				this.camera.rotationY = (i.settings._360.trueNorth - 0.5) * Math.PI * 2;
		}

		// Set derived flags and properties
		this.noImage = this.noImage || this.isOmni || (!i.id && !i.tilesId); // Mark as noImage if Omni or no tile source
		this.extension = i.tileExtension || i.isPng && 'png' || i.isWebP && 'webp' || 'jpg'; // Determine tile extension
		if(i.format == 'dz') i.isDeepZoom = true; // Set deep zoom flag
		this.is360 = !!i.is360;
		this.isVideo = !!i.isVideo;

		// Determine initial language from revision
		let lang = get(micrio._lang);
		if(i.revision) {
			const langs = Object.keys(i.revision);
			if(langs.length && !langs.includes(lang as string))
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

		// Load image data immediately if revisions are known and not an embed
		if(i.revision && !this.opts.isEmbed && !(this.noImage && !this.isOmni)) {
			const d = await DataLoader.getBundleImage(this.id).then(r => r?.data);
			if (d) {
				micrio.events.dispatch('pre-data', { [this.id]: d });
				this.data.set(d);
			}
		}

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

		// Set watermark if present
		if(i.watermark) this.engine.micrio.webgl.loadWatermark(i.watermark, i.settings?.watermarkOpacity);

		delete i.settings; // Remove settings from info object after processing

		// Hook Omni controls if applicable
		if(this.isOmni) this.state.hookOmni();

		return i; // Return the processed info object
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
		if(jsCss.includes(s) || document.querySelector('script[src="'+s+'"]')) ok(); // Already loaded
		else { jsCss.push(s); // Mark as loading
			const _el = document.createElement('script'); _el.type = 'text/javascript';
			_el.async = true; _el.defer = true;
			/** @ts-ignore -- used for custom JS to have a cool self reference */
			_el['micrioElement'] = this.engine.micrio; // Pass Micrio element reference
			_el.src = s.replace('$lang', lang); _el.onload = ok; document.head.appendChild(_el);
		}
	})}

	/** Loads an external stylesheet dynamically. Ensures stylesheets are loaded only once.
	 * @internal
	 */
	private loadStyle(s:string) : Promise<void> { return new Promise((ok:() => void) => {
		if(jsCss.includes(s) || document.head.querySelector('link[href="'+s+'"]')) ok(); // Already loaded
		else { jsCss.push(s); // Mark as loading
			const _el = document.createElement('link'); _el.setAttribute('type', 'text/css');
			_el.setAttribute('rel', 'stylesheet'); _el.setAttribute('href', s);
			_el.onload = ok; document.head.appendChild(_el);
		}
	})}

	/** Configures the info object as a strip-swipe gallery container and sets the
	 * parent's dimensions to match the element's viewport. Returns the starting
	 * slot index resolved from `gallery.startId` (or 0).
	 * @internal
	 */
	private setupIIIFGalleryContainer(i:Models.ImageInfo.ImageInfo, ids:string[]) : number {
		this.noImage = true;
		// Size the virtual parent to the element's current pixel dimensions so child
		// strip-swipe slots render at the full viewport aspect (matches loadGallery's
		// strip-swipe path). Using sum-of-widths × max-of-heights here would letterbox
		// the parent and squash all children into that strip.
		const micrio = this.engine.micrio;
		const ratio = micrio.canvas.getRatio();
		i.width = Math.max(1, micrio.offsetWidth * ratio);
		i.height = Math.max(1, micrio.offsetHeight * ratio);
		if(!i.settings) i.settings = {};
		if(!i.settings.gallery) i.settings.gallery = {};
		i.settings.view = [0, 0, 1, 1];
		i.gallery = [];
		const startId = i.settings.gallery.startId;
		const startIdx = startId ? ids.findIndex(id => id == startId) : -1;
		return startIdx < 0 ? 0 : startIdx;
	}

	/** Parses IIIF Presentation API V2 sequence data. For short sequences the canvases
	 * are treated as positioned embeds in a composite image; long sequences (>10) are
	 * configured as a swipeable gallery.
	 * @internal
	 */
	private parseIIIFSequenceV2(i:Models.ImageInfo.ImageInfo, isIIIFSequence:boolean=false) : void {
		const s = i.sequences?.[0];
		if(!s) return;
		const images = s.canvases.map(c => c.images[0]).map(i => i.resource);
		const isGallery = isIIIFSequence && images.length > 10;

		if(isGallery) {
			const startIdx = this.setupIIIFGalleryContainer(i, images.map(s => s.service['@id']));
			images.forEach((s, idx) => i.gallery!.push(new MicrioImage(this.engine, {
				id: s.service['@id'],
				width: s.width, height: s.height,
				isPng: s.format == 'image/png',
				settings: {}
			}, {
				area: [idx - startIdx, 0, idx - startIdx + 1, 1]
			})));
			return;
		}

		// Composite layout: position each canvas as an embed within a single virtual parent.
		const vertical = s.viewingDirection == 'top-to-bottom';
		this.noImage = true;
		i.width = !vertical ? images.reduce((v, i) => v+i.width, 0) : Math.max(...images.map(i => i.width));
		i.height = vertical ? images.reduce((v, i) => v+i.height, 0) : Math.max(...images.map(i => i.height));
		if(!i.settings) i.settings = {};
		let offset = 0;
		images.forEach(s => {
			const margins = [ (1 - (s.width / i.width)) / 2, (1 - (s.height / i.height)) / 2 ];
			this.embeds.push(new MicrioImage(this.engine, {
				id: s.service['@id'],
				width: s.width, height: s.height,
				isPng: s.format == 'image/png',
				settings: {}
			}, {
				area: vertical ? [margins[0], offset/i.height, 1-margins[0], (offset+s.height)/i.height]
					: [offset/i.width, margins[1], (offset+s.width)/i.width, 1-margins[1] ]
			}));
			offset += vertical ? s.height : s.width;
		});
	}

	/** Parses IIIF Presentation API V3 sequence data to create a swipeable gallery.
	 * @internal
	 */
	private parseIIIFSequenceV3(i:Models.ImageInfo.ImageInfo) : void {
		const images = i.items?.flatMap(p => p.items?.[0]?.items?.[0]?.body).filter(p => !!p?.service?.[0]?.id).filter(p => !!p);
		if(!images?.length) return;
		const startIdx = this.setupIIIFGalleryContainer(i, images.map(s => s.service[0].id));
		images.forEach((s, idx) => i.gallery!.push(new MicrioImage(this.engine, {
			id: s.service[0].id,
			width: s.width, height: s.height,
			isPng: s.format == 'image/png',
			tileSize: i.tileSize,
			settings: {}
		}, {
			area: [idx - startIdx, 0, idx - startIdx + 1, 1]
		})));
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
		const img = new MicrioImage(this.engine, info, {area:a, isEmbed: true, useParentCamera: opts.asImage});
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
			// Add the embed to the engine
			this.engine.addEmbed(img, this, opts);
			this.engine.render(); // Trigger render
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
		const p = this.engine.micrio.canvas.viewport.portrait; // Check orientation
		// Set area for primary image (left/top half)
		this.opts.secondaryTo?.camera.setArea(p ? [0,0,1,.5] : [0,0,.5,1], {noRender:true});
		// Set area for this secondary image (right/bottom half)
		this.camera.setArea(p ? [0,.5,1,1] : [.5,0,1,1], {noRender:true});
		// Set initial view for this image
		this.camera.setView(this.__info?.settings?.view ?? [0,0,1,1])
		this.engine.render(); // Trigger render
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
		this.engine.render(); // Trigger render
	}

	/** Fades in the image smoothly or instantly. */
	fadeIn(direct:boolean=false) : void {
		this.engine.fadeImage(this.ptr, 1, direct);
		this.engine.render();
	}

	/** Fades out the image smoothly or instantly. */
	fadeOut(direct:boolean=false) : void {
		this.engine.fadeImage(this.ptr, 0, direct);
		this.engine.render();
	}

}
