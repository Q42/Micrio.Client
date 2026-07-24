import type { Models } from '$types/models';
import type { Writable } from '$core/store';
import type { Grid } from '$grid/grid';
import type { Engine } from '$render/engine';
import type { TileCanvas } from '$render/tile-canvas';
import type { OmniUI } from '$gallery/omni';
import type { HTMLMicrioElement } from './element'; // Import HTMLMicrioElement type

import { BASEPATH, BASEPATH_V5, BASEPATH_V5_EU, DEFAULT_TILE_SIZE, VIEWER_BASE } from './globals';
import { Camera } from './camera';
import { writable, get } from '$core/store';
import { getIdVal, idIsV5, randomUUID } from '$utils/id';
import { DataLoader } from '$utils/dataLoader';
import { State } from './state';
import { createElement, loadScript } from '$utils/dom';

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
	readonly uuid: string = randomUUID();

	/** The image's core information (dimensions, format, settings, etc.). See {@link Models.ImageInfo.ImageInfo}. */
	readonly #info: Models.ImageInfo.ImageInfo;

	/** Getter for the current value of the {@link info} property.
	 * @readonly
	*/
	get $info():Models.ImageInfo.ImageInfo { return this.#info }

	/**  Writable store holding the image's specific settings, often merged from attributes and info data. See {@link Models.ImageInfo.Settings}. */
	readonly _settings: Writable<Models.ImageInfo.Settings> = writable({});

	/** Getter for the current value of the {@link settings} store. */
	get $settings():Models.ImageInfo.Settings { return get(this._settings) }

	/**  Writable store holding the image's cultural data (markers, tours, text content for the current language). See {@link Models.ImageData.ImageData}. */
	readonly data: Writable<Models.ImageData.ImageData|undefined> = writable(undefined);

	/** Getter for the current value of the {@link data} store. */
	get $data():Models.ImageData.ImageData|undefined { return get(this.data) }

	/** State manager specific to this image instance (view, active marker, etc.). See {@link State.Image}. */
	readonly state:State.Image;

	/** The virtual camera instance controlling the view for this image. */
	camera!:Camera;

	/**  Writable store holding the HTMLVideoElement if this image represents a video. */
	readonly video:Writable<HTMLVideoElement|undefined> = writable(undefined);

	/**  Writable store indicating if this image's canvas is currently visible and being rendered.
	 * @readonly
	*/
	readonly visible: Writable<boolean> = writable(false);

	/** Album information if this image is part of a V5 album. */
	album?: Models.Album|undefined;

	/** OmniUI instance, if this image is an omni 3D object. */
	omni: OmniUI|undefined;

	/** Grid controller instance, if this image is a grid container. */
	grid: Grid|undefined;

	/** Stores the camera view state when a marker is opened, used to return to the previous view. */
	_openedView: Models.Camera.View|undefined;

	/** Internal reference to the video element.
	 * @internal
	*/
	_video:HTMLVideoElement|undefined;

	/** Base path URI for fetching `data.[lang].json` files. */
	_dataPath: string;

	/** Stores an error message if loading failed. */
	error: string|undefined;

	/** Whether this image has been placed on the compute engine.
	 * @readonly
	 * @internal
	*/
	_placed: boolean = false;

	/** Base tile index within the engine texture atlas.
	 * @readonly
	 * @internal
	*/
	_baseTileIdx: number = -1;

	/** Flag indicating if this is a 360 panoramic image.
	 * @readonly
	 * @internal
	*/
	_is360: boolean = false;

	/** Flag indicating if this represents a video texture.
	 * @readonly
	 * @internal
	*/
	_isVideo: boolean = false;

	/** Flag indicating if this is an Omni (3D object) viewer.
	 * @readonly
	 * @internal
	*/
	_isOmni: boolean = false;

	/** Number of zoom levels available for this image.
	 * @readonly
	 * @internal
	*/
	_levels: number = 1;

	/** Number of DeepZoom levels (used for IIIF/DZI).
	 * @readonly
	 * @internal
	*/
	#dzLevels: number = 0;

	/** Source URL for the image thumbnail.
	 * @readonly
	 * @internal
	*/
	thumbSrc?: string;

	/** File extension for image tiles (e.g., 'jpg', 'png', 'webp').
	 * @readonly
	 * @internal
	*/
	#extension: string|undefined;

	/** Flag indicating if this is a virtual canvas (e.g., gallery container) without its own image tiles.
	 * @readonly
	 * @internal
	*/
	_noImage: boolean = false;

	/** Initial opacity when the image is added (used for embeds/transitions).
	 * @readonly
	 * @internal
	*/
	_opacity: number = 1;

	/**  Writable store holding the calculated pixel viewport [left, top, width, height] of this image within the main canvas. */
	readonly _viewport:Writable<Models.Camera.View> = writable<Models.Camera.View>();

	/** Array of child {@link MicrioImage} instances embedded within this image. */
	readonly _embeds: MicrioImage[] = [];

	/** Base path for fetching image tiles. */
	_tileBase:string|undefined;

	/** The engine this image is managed by. */
	get engine(): Engine { return this.#engine; }

	/** The engine TileCanvas for this image, if placed. */
	get canvas(): TileCanvas | undefined { return this.#engine._getCanvas(this); }

	readonly #engine: Engine;
	opts: {
		/** Optional sub area [x, y, width, height] defining placement within a parent canvas (for embeds/galleries). */
		area?: Models.Camera.View;
		/** If true, this image is embedded within another image (affects rendering/camera). */
		isEmbed?: boolean;
		/** If true, uses the parent image's camera instead of creating its own (for switch/omni galleries). */
		useParentCamera?: boolean;
	};

	/**
	 * Creates a new MicrioImage instance. Typically called by {@link HTMLMicrioElement.open}.
	 * @internal
	 * @param engine The global Engine controller instance.
	 * @param bundle The image's full {@link ImageBundle.BundleImage} data (from bundle.json).
	 * @param opts Options controlling behavior (embedding, split-screen, etc.).
	 */
	constructor(
		engine: Engine,
		bundle: Models.ImageBundle.BundleImage,
		opts: {
			/** Optional sub area [x, y, width, height] defining placement within a parent canvas (for embeds/galleries). */
			area?: Models.Camera.View;
			/** If true, this image is embedded within another image (affects rendering/camera). */
			isEmbed?: boolean;
			/** If true, uses the parent image's camera instead of creating its own (for switch/omni galleries). */
			useParentCamera?: boolean;
		} = {}
	) {
		this.#engine = engine;
		this.opts = opts;
		this.state = new State.Image(this);
		if(!opts.useParentCamera) this.camera = new Camera(this);

		this.id = bundle.id.replace(VIEWER_BASE,'');

		if(this.id.startsWith('external/')) {
			const secondSlash = this.id.indexOf('/', this.id.indexOf('/') + 1);
			if(secondSlash !== -1)
				this.id = this.id.substring(0, secondSlash + 1) + encodeURIComponent(this.id.substring(secondSlash + 1));
		}

		const i = bundle.info;
		this.#info = i;
		this._dataPath = i.path || BASEPATH_V5;

		if(!opts.area) opts.area = [0,0,1,1];

		const s = bundle.settings;
		const micrio = this.#engine.micrio;

		// V5 ID detection & derived info flags
		if (!i.isIIIF && this.id.length == 7) {
			const b = getIdVal(this.id[1 + (getIdVal(this.id) % 6)]);
			i.is360 = !!((b >> 4) & 1) || !!i.is360;
			i.isWebP = !(b & 3);
			i.isPng = (b & 3) == 2;
			if ((b >> 3) & 1 && idIsV5(i.tilesId ?? this.id)) i.format = 'dz';
			if (!i.path) i.path = `https://${!((b >> 2) & 1) ? 'r2' : 'eu'}.micr.io/`;
		}

		// Determine tile base path
		const isV5Imported = this.id.length == 6 && this.id.startsWith('i') && !this.id.includes('/');
		const isExternal = isV5Imported && !i.tileBasePath?.includes('micr.io');
		this._tileBase = isExternal ? i.tileBasePath ?? BASEPATH : isV5Imported ? BASEPATH : i.tileBasePath ?? i.path ?? BASEPATH_V5;

		const org = DataLoader._getOrganisation();
		if(org?.baseUrl && !i.path.includes(org.baseUrl)) {
			this._dataPath = i.path = org.baseUrl;
			if(!isV5Imported) this._tileBase = this._dataPath;
		}
		else if(i.path == BASEPATH_V5_EU) this._dataPath = i.path;
		else if(i.path) this._dataPath = i.path;

		// Omni object setup
		if(s?.omni) {
			this._isOmni = true;
		}

		// Org branding CSS (fire & forget)
		if(org?.branding && !(s?.noUI)) {
			const r2Base = `https://${(org.logo?.src?.indexOf('/eu.') ?? -1) >= 0 ? 'eu' : 'r2'}.micr.io/`;
			this.#loadStyle(r2Base+'style/'+org.slug+'.css').then(() => {
				const fontFamily = getComputedStyle(this.#engine.micrio).getPropertyValue('--micrio-font-family')?.replace(/^'([^']+)'.*$/,'$1');
				if(fontFamily) document.fonts.ready.then(() => { if(!document.fonts.check('16px ' + fontFamily))
					this.#loadStyle(`https://fonts.googleapis.com/css2?family=${fontFamily}:ital,wght@0,300;0,400;0,500;0,600;0,800;1,300;1,400;1,500;1,600;1,800&display=swap`)
				});
			});
		}

		// IIIF: extract short identifier from full URL
		if(i.isIIIF && i.id.includes('/')) {
			i.id = (('@id' in i ? (i as any)['@id'] : i.id) as string).replace(/^.*\//, '');
		}

		// 360 space data
		if(i.spacesId && !micrio.spaceData) {
			micrio.spaceData = DataLoader._getSpaceData(i.spacesId);
			if(micrio.spaceData?.images.length == 1) delete micrio.spaceData;
		}

		if(i.is360 && this.camera) {
			const spaceRotY = micrio.spaceData?.images.find(img => img.id == this.id)?.rotationY;
			if(spaceRotY != null) this.camera.rotationY = spaceRotY;
			else if(s?._360?.trueNorth != null)
				this.camera.rotationY = (s._360.trueNorth - 0.5) * Math.PI * 2;
		}

		// Derived flags & properties
		this._noImage = this._noImage || this._isOmni || (!i.id && !i.tilesId);
		this.#extension = i.tileExtension || i.isPng && 'png' || i.isWebP && 'webp' || 'jpg';
		if(i.format == 'dz') i.isDeepZoom = true;
		this._is360 = !!i.is360;
		this._isVideo = !!i.isVideo;

		// Language from revision
		let lang = get(micrio._lang);
		if(i.revision) {
			const langs = Object.keys(i.revision);
			if(langs.length && !langs.includes(lang as string))
				micrio.lang = langs.includes('en') ? 'en' : langs[0];
		}

		// Custom JS/CSS (fire & forget)
		if(s && !s.noExternals) {
			if(s.css) this.#loadStyle(s.css.href);
			if(s.js) {
				const url = s.js.href.replace('$lang', lang);
				loadScript(url);
				const _el = document.head.querySelector('script[src="'+url+'"]') as HTMLScriptElement | undefined;
				/** @ts-ignore -- used for custom JS to have a cool self reference */
				if (_el) _el['micrioElement'] = this.#engine.micrio;
			}
		}

		// Zoom levels
		for(let f=i.tileSize ?? DEFAULT_TILE_SIZE; f < Math.max(i.width,i.height); f *= 2, this._levels++) {}
		let max = Math.max(i.width, i.height); do this.#dzLevels++; while((max/=2) > 1);
		if(s?.gallery?.archive) this._levels -= 1 - (s.gallery.archiveLayerOffset ?? 0);
		if(!this._noImage) this.thumbSrc = this.getTileSrc(this._levels, 0, 0);

		micrio.events.dispatch('pre-info', i);

		// Bundle data
		if((!this._noImage || this._isOmni) && !s?.skipMeta && bundle.data) {
			this.data.set(bundle.data);
		}

		// Settings store & watermark
		if(s) this._settings.set(s);
		if(i.watermark) this.#engine.micrio._webgl._loadWatermark(i.watermark, s?.watermarkOpacity);

		// Omni controls hook
		if(this._isOmni) {
			this.state.layer.subscribe(l => {
				if(!this._placed || !this.#engine.ready) return;
				this.canvas?._setActiveLayer(l);
				this.#engine.render();
			});
		}

		const micrioRef = this.#engine.micrio;

		// Visibility subscription
		let wasVis:boolean=get(this.visible);
		this.visible.subscribe(v => {
			if(v==wasVis) return; wasVis=v;

			micrioRef._visible.update(l => {
				if(v) l.push(this);
				else l.splice(l.indexOf(this), 1);
				return l;
			});
			if(v && micrioRef.$current == this) micrioRef._switching.set(false);
		});

		this.video.subscribe(v => this._video = v);
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
		const i = this.#info;

		// Adjust layer index for DeepZoom format
		if(i.isDeepZoom) layer = this.#dzLevels - layer;

		// Handle IIIF URL generation
		if(i.isIIIF) {
			const tileSize = i.tileSize ?? DEFAULT_TILE_SIZE;
			const ts = Math.pow(2, layer) * tileSize;
			const left = Math.min(i.width, x * ts);
			const top = Math.min(i.height, y * ts);
			const regionW = Math.min(i.width-left, ts);
			const regionH = Math.min(i.height-top, ts);
			const sizeW = Math.round(Math.min(tileSize, regionW / ts * tileSize));
			const sizeH = Math.round(Math.min(tileSize, regionH / ts * tileSize));
			return `${i.path}/${i.id}/${[left,top,regionW,regionH].join(',')}/${[sizeW,sizeH].join(',')}/0/default.jpg`;
		}

		// Throw error if trying to get tile for a video (shouldn't happen)
		if(this.$settings?._360?.video?.src)
			throw new Error('Video thumb');

		// Construct standard Micrio tile URL
		return `${this._tileBase}${i.tilesId||i.id}/${frame !== undefined ? frame + '/' : ''}${layer}/${x}${i.isDeepZoom?'_':'-'}${y}.${this.#extension}`;
	}

	/** Loads an external stylesheet dynamically. Ensures stylesheets are loaded only once.
	 * @internal
	 */
	#loadStyle(s:string) : Promise<void> { return new Promise((ok:() => void) => {
		if(jsCss.includes(s) || document.head.querySelector('link[href="'+s+'"]')) ok(); // Already loaded
		else { jsCss.push(s); // Mark as loading
			createElement('link', {
				attrs: { type: 'text/css', rel: 'stylesheet', href: s },
				events: { load: ok as EventListener },
				parent: document.head
			});
		}
	})}

	/**
	 * Adds an embedded MicrioImage (representing another Micrio image or video) within this image.
	 * @param info Partial info data for the embed.
	 * @param settings Optional settings for the embed.
	 * @param area The placement area `[x, y, width, height]` within the parent image.
	 * @param opts Embedding options (opacity, fit, etc.).
	 * @returns The newly created embedded {@link MicrioImage} instance.
	 */
	addEmbed(info:Partial<Models.ImageInfo.ImageInfo>, settings: Partial<Models.ImageInfo.Settings> | undefined, area:Models.Camera.View, opts:Models.Embeds.EmbedOptions = {}) : MicrioImage {
		const a = area.slice(0); // Clone area array
		// Create new MicrioImage instance for the embed
		const img = new MicrioImage(this.#engine, {
			id: info.id ?? '',
			info: { ...info, id: info.id ?? '' } as Models.ImageInfo.ImageInfo,
			data: DataLoader._getBundleImageSync(info.id ?? '')?.data,
			settings,
		}, {area:a, isEmbed: true, useParentCamera: opts.asImage});
		// Use parent camera if specified (e.g., for switch galleries)
		if(!img.camera) img.camera = this.camera;
		this._embeds.push(img); // Add to embeds list
		if(opts.opacity === undefined) opts.opacity = 1; // Default opacity

		// Adjust area based on 'fit' option (cover or contain)
		if(opts.fit == 'cover' || opts.fit == 'contain') {
			const i = img.$info;
			const yS = this._is360 ? 2 : 1; // Y-scale factor for 360
			const isCover = opts.fit == 'cover';
			const aW = a[2], aH = a[3], cX = a[0] + aW/2, cY = a[1] + aH/2; // Area dimensions/center
			const aAr = aW / aH * yS; // Area aspect ratio
			const imgAr = i.width / i.height; // Image aspect ratio
			// Adjust area dimensions based on aspect ratios and fit mode
			if((isCover && imgAr < aAr) || (!isCover && imgAr >= aAr)) { // Adjust height
				const nH = aW / imgAr * yS; a[1] = cY - nH/2; a[3] = nH;
			} else { // Adjust width
				const nW = aH * imgAr / yS; a[0] = cX - nW/2; a[2] = nW;
			}
		}
		// Add the embed to the engine
		this.#engine._addEmbed(img, this, opts);
		this.#engine.render(); // Trigger render
		return img; // Return the new embed instance
	}

	/** Map storing references to HTMLMediaElements associated with video embeds. @internal */
	#embedElements:Map<string, HTMLMediaElement> = new Map();

	/** Sets the HTMLMediaElement reference for a given embed ID. @internal */
	setEmbedMediaElement(id:string, el?:HTMLMediaElement) : void {
		if(el) this.#embedElements.set(id, el);
		else this.#embedElements.delete(id);
	}

	/** Gets the HTMLMediaElement associated with a video embed ID. */
	getEmbedMediaElement(id:string) : HTMLMediaElement|undefined {
		return this.#embedElements.get(id);
	}

	/** Fades in the image smoothly or instantly. */
	fadeIn(direct:boolean=false) : void {
		const c = this.canvas;
		if (c) { c._targetOpacity = 1; if (direct) c._opacity = 1; }
		this.#engine.render();
	}

	/** Fades out the image smoothly or instantly. */
	fadeOut(direct:boolean=false) : void {
		const c = this.canvas;
		if (c) { c._targetOpacity = 0; if (direct) c._opacity = 0; }
		this.#engine.render();
	}

}
