import type { Models } from '../types/models';
import type { Readable, Unsubscriber, Writable } from 'svelte/store';
import type { Grid } from './grid';
import type { Wasm } from './wasm';
import type { GallerySwiper } from './swiper';
import type { PREDEFINED } from '../types/internal';

import { BASEPATH, BASEPATH_V5, BASEPATH_V5_EU, DEFAULT_INFO, DEMO_IDS } from './globals';
import { Camera } from './camera';
import { readable, writable, get } from 'svelte/store';
import { createGUID, deepCopy, fetchInfo, fetchJson, getIdVal, getLocalData, idIsV5, isFetching, loadSerialTour, once, sanitizeAsset, sanitizeImageData, sanitizeMarker } from './utils';
import { State } from './state';
import { archive } from './archive';

/** Keep track of already loaded scripts-- only do this once per session
 * @private
*/
const jsCss:string[] = [];

/**
 * An individual Micrio image
 * @author Marcel Duin <marcel@micr.io>
*/
export class MicrioImage {
	/** The image id */
	readonly id: string;

	/** Unique instance id */
	readonly uuid: string = createGUID();

	/** Internal Models.ImageInfo.ImageInfo for direct use
	 * @internal
	 * @readonly
	*/
	private __info:Models.ImageInfo.ImageInfo = JSON.parse(JSON.stringify(DEFAULT_INFO));

	/** The Micrio info data Readable store */
	readonly info: Readable<Models.ImageInfo.ImageInfo|undefined>;

	/** The image info data
	 * @readonly
	*/
	get $info():Models.ImageInfo.ImageInfo|undefined { return this.__info }

	/** The image settings Writable */
	readonly settings: Writable<Models.ImageInfo.Settings> = writable({});

	/** The current CultureData */
	get $settings():Models.ImageInfo.Settings { return get(this.settings) }

	/** The Micrio culture data Writable */
	readonly data: Writable<Models.ImageData.ImageData|undefined> = writable(undefined);

	/** The current CultureData */
	get $data():Models.ImageData.ImageData|undefined { return get(this.data) }

	/** State manager */
	public readonly state:State.Image;

	/** The virtual camera instance to control the current main image views */
	public camera!:Camera;

	/** The 2D or 360 video MediaElement */
	public readonly video:Writable<HTMLVideoElement|undefined> = writable(undefined);

	/** The canvas is currently visible
	 * @readonly
	*/
	public readonly visible: Writable<boolean> = writable(false);

	/** Album info if image is part of an album (V5+) */
	public album?: Models.Album|undefined;

	/** Gallery swiper instance */
	public swiper: GallerySwiper|undefined;

	/** The last opened view */
	openedView: Models.Camera.View|undefined;

	/** Internal video reference
	 * @internal
	*/
	_video:HTMLVideoElement|undefined;

	/** The json info path uri -- undefined = https://i.micr.io/
	 * @internal
	*/
	private infoBasePath: string|undefined;

	/** The json data path uri
	 * @internal
	*/
	dataPath: string;

	/** Error, if any */
	error: string|undefined;

	/** WebAssembly instance mem pointer
	 * @readonly
	 * @internal
	*/
	ptr: number = -1;

	/** WebAssembly instance base tile idx
	 * @readonly
	 * @internal
	*/
	baseTileIdx: number = -1;

	/** This is a 360 image
	 * @readonly
	 * @internal
	*/
	is360: boolean = false;

	/** This is a 360 video
	 * @readonly
	 * @internal
	*/
	isVideo: boolean = false;

	/** This is a 360 object viewer
	 * @readonly
	 * @internal
	*/
	isOmni: boolean = false;

	/** Number of zoomlevels
	 * @readonly
	 * @internal
	*/
	levels: number = 1;

	/** Number of DeepZoom levels
	 * @readonly
	 * @internal
	*/
	dzLevels: number = 0;

	/** Thumbnail src
	 * @readonly
	 * @internal
	*/
	thumbSrc?: string;

	/** Tile file extension
	 * @readonly
	 * @internal
	*/
	extension: string|undefined;

	/** Is a virtual canvas
	 * @readonly
	 * @internal
	*/
	noImage: boolean = false;

	/** The initial opacity
	 * @readonly
	 * @internal
	*/
	opacity: number = 1;

	/** Rendered pixel rectangle [left, top, width, height] */
	public readonly viewport:Writable<Models.Camera.View> = writable<Models.Camera.View>();

	/** Predefined global data
	 * @internal
	*/
	readonly preset: PREDEFINED|undefined;

	/** Embedded in-image children */
	readonly embeds: MicrioImage[] = [];

	/** Grid controller */
	public grid: Grid|undefined;

	/** Is new language data model
	 * @internal
	 * @readonly
	*/
	isV5:boolean = false;

	/** The tile basePath */
	tileBase:string|undefined;

	/** Create a new MicrioImage
	 * @internal
	 * @param wasm The global Wasm controller
	 * @param attr Image info settings from attributes
	 * @param opts Optional settings
	 */
	constructor(
		public wasm: Wasm,
		private attr:Partial<Models.ImageInfo.ImageInfo>,
		public opts:{
			/** Optional sub area for partial / embedded images */
			area?: Models.Camera.View;
			/** For split screen, the image this is secondary to */
			secondaryTo?: MicrioImage;
			/** Follow the movements of the main image */
			isPassive?: boolean;
			/** This is an in-image embed */
			isEmbed?: boolean;
			/** For non-independent embeds, use the parent's .camera */
			useParentCamera?: boolean;
		} = {}
	) {
		this.state = new State.Image(this);
		if(!opts.useParentCamera) this.camera = new Camera(this);

		this.id = (attr.id??'').replace('https://i.micr.io/','');
		this.isV5 = idIsV5(this.id.split('/')[0]);
		this.infoBasePath = attr.path && attr.forceInfoPath ? attr.path : undefined;
		this.dataPath = attr.path||this.__info.path;
		if(this.isV5 && !attr.path) this.dataPath = BASEPATH_V5;

		if(opts.secondaryTo) {
			this.opacity = 0;
			opts.area = this.wasm.micrio.canvas.viewport.portrait ? [0,1,1,1] : [1,0,1,1];
			if(opts.isPassive === undefined) opts.isPassive = true;
		}
		else if(!opts.area) opts.area = [0,0,1,1];

		this.preset = getLocalData(this.id);

		let l:boolean = false;
		this.info = readable<Models.ImageInfo.ImageInfo|undefined>(undefined, set => {
			l ? set(this.__info) : this.load().then(set); l=!0;
		});

		const micrio = this.wasm.micrio;

		const hasData = !!this.attr.revision;

		let wasVis:boolean=get(this.visible);
		let followUnsub:Unsubscriber|null;
		if(!opts.isEmbed || hasData) this.visible.subscribe(v => {
			if(v==wasVis) return; wasVis=v;

			if(v && !this._loadedData) {
				if(!hasData && this.isV5) {
					this._loadedData = true;
					this.data.set(undefined);
				}
				else this.loadData();
			}

			// Splitscreen hooks
			if(opts.secondaryTo) {
				if(opts.isPassive) {
					if(followUnsub) { followUnsub(); followUnsub = null; }
					else if(v) followUnsub = opts.secondaryTo.state.view.subscribe(v => {
						if(v && !this.camera.aniDone) this.camera.setView(v, {noLimit: true})
					});
				}

				if(v) micrio.events.dispatch('splitscreen-start', this);
				else micrio.events.dispatch('splitscreen-stop', this);
			}
			micrio.visible.update(l => {
				if(v) l.push(this);
				else l.splice(l.indexOf(this), 1);
				return l;
			});
			if(v && micrio.$current == this) micrio.switching.set(false);
		});

		this.video.subscribe(v => this._video = v);

		// Sanitize markers on data set
		this.data.subscribe(d => sanitizeImageData(d, this.is360, this.isV5));
	}

	private setError(e:Error, err?:string) {
		this.wasm.micrio.printError(this.error = err??e?.message??e?.toString()??'An unknown error has occurred');
		this.wasm.micrio.loading.set(false);
		throw e;
	}

	/** Load the image's info data
	 * @internal
	 * @param attr The HTML attribute settings
	*/
	private async load() : Promise<Models.ImageInfo.ImageInfo> {
		let i = this.__info;

		const attr = this.attr;
		const micrio = this.wasm.micrio;

		// If explicit Info object passed to load, keep its original reference
		if(attr.id && attr.width) {
			if(attr.settings) deepCopy(DEFAULT_INFO.settings, attr.settings, {noOverwrite: true});
			this.__info = i = attr as Models.ImageInfo.ImageInfo;
		}

		let iiifManifest = i.iiifManifest||attr.iiifManifest;

		i.isIIIF = this.id.startsWith('http') || i.format == 'iiif';

		if(this.id && (!attr.width || !attr.height || iiifManifest)) {
			const loadError = (e:Error) => this.setError(e, 'Image with id "'+this.id+'" not found, published, or embeddable.');
			deepCopy(this.preset?.[1] || await (i.isIIIF ? fetchJson(this.id) : fetchInfo(this.id, this.infoBasePath)).catch(loadError), i);
			if(!iiifManifest && i.iiifManifest) iiifManifest = i.iiifManifest;
			if(!i.isIIIF) i.isIIIF = !!iiifManifest;
			if(iiifManifest) deepCopy(await fetchJson(iiifManifest).catch(loadError), i);
			if(!!i.settings?._meta?.['noLogo']) i.settings.noLogo = true;
			if(!!i.settings?._meta?.['noSmoothing']) i.settings.noSmoothing = true;
		}
		else if(this.preset?.[1]) deepCopy(this.preset[1], i);

		// IDs with length 7 have metadata encoded in them
		if(this.id?.length == 7) {
			const b = getIdVal(this.id[1+(getIdVal(this.id)%6)]); i.is360=!!((b>>4)&1); i.isWebP=!(b&3); i.isPng=(b&3)==2;
			if((b>>3)&1 && idIsV5(i.tilesId??this.id)) i.format='dz'; if(!i.path) i.path = `https://${!((b>>2)&1)?'r2':'eu'}.micr.io/`;
		}

		// Imported images into new dash are id length 6 and start with unique 'i', and not an asset gallery image
		const isV5Imported = this.isV5 && this.id.startsWith('i') && !this.id.includes('/');
		if(isV5Imported && !i.tilesId) i.tilesId = this.id.slice(1);
		const isDemo = DEMO_IDS.indexOf(i.id) >= 0 || i.tilesId && DEMO_IDS.indexOf(i.tilesId) >= 0;

		// HTML attributes override server gotten ones
		deepCopy(attr, i);

		const isExternal = isV5Imported && !i.tileBasePath?.includes('micr.io');
		this.tileBase = isExternal ? i.tileBasePath ?? BASEPATH : (isDemo || isV5Imported) ? BASEPATH : i.tileBasePath ?? i.path ?? (this.isV5 ? BASEPATH_V5 : BASEPATH);
		if(i.organisation?.baseUrl && !attr.path) {
			this.dataPath = i.path = i.organisation.baseUrl;
			if(!isV5Imported || isDemo) this.tileBase = this.dataPath;
		}
		else if(i.path == BASEPATH_V5_EU) this.dataPath = i.path;

		if(i.settings?.omni) {
			this.isOmni = true;
			if(i.version >= 5) {
				await archive.load(this.tileBase??this.dataPath, (i.tilesId??i.id)+'/base', p => micrio._ui?.$set({loadingProgress: p}))
					.catch(e => this.setError(e, 'Could not find object base package.'));
				if(!i.settings.gallery) i.settings.gallery = {};
				i.settings.gallery.type = 'omni';
				i.settings.gallery.archive = i.id;
			}
		}

		if(i.organisation?.branding && !(i.settings && i.settings.noUI)) {
			this.loadStyle(this.dataPath+'style/'+i.organisation.slug+'.css').then(() => {
				const fontFamily = getComputedStyle(this.wasm.micrio).getPropertyValue('--micrio-font-family')?.replace(/^'([^']+)'.*$/,'$1');
				if(fontFamily) document.fonts.ready.then(() => { if(!document.fonts.check('16px ' + fontFamily))
					this.loadStyle(`https://fonts.googleapis.com/css2?family=${fontFamily}:ital,wght@0,300;0,400;0,500;0,600;0,800;1,300;1,400;1,500;1,600;1,800&display=swap`)
				});
			});
		}

		if(i.isIIIF) {
			if(i.sequences && i.sequences.length) this.parseIIIFSequence(i, !!iiifManifest);
			else {
				const id:string = (iiifManifest || ('@id' in i ? i['@id'] : i.id) as string).replace('/info.json', '');
				i.path = id.replace(/\/[^/]*$/,'');
				i.id = id.replace(/^.*\/([^/]*)$/,'$1');
			}
		}

		// Spaces
		if(i.spacesId && !micrio.spaceData) {
			micrio.spaceData = 'MICRIO_SPACE_DATA' in self ? self['MICRIO_SPACE_DATA'] as Models.Spaces.Space
				: await fetchJson<Models.Spaces.Space>('https://i.micr.io/spaces/'+i.spacesId+'.json');
		}

		if(i.settings?._360) {
			const rotY = micrio.spaceData?.images.find(i => i.id == this.id)?.rotationY??0;
			i.settings._360.trueNorth = .5 + rotY / Math.PI / 2;
		}

		this.noImage = this.noImage || this.isOmni || (!i.id && !i.tilesId);
		this.extension = i.tileExtension || i.isPng && 'png' || i.isWebP && 'webp' || 'jpg';
		if(i.format == 'dz') i.isDeepZoom = true;
		this.is360 = !!i.is360;
		this.isVideo = !!i.isVideo;

		let lang:string|undefined=this.isV5 ? get(micrio._lang) : (!('cultures' in i) ? attr.lang : undefined) ?? undefined;

		// Set available culture data
		if(!this.isV5) {
			if(!i.settings?.skipMeta && 'cultures' in i) {
				const c = (i.cultures as string || '').split(',');
				const isChild = this.opts.isEmbed || !!this.opts.area;
				const forceLang = i.settings?.onlyPreferredLang || isChild;
				lang = i.lang && c.indexOf(i.lang) >= 0 ? i.lang : forceLang ? undefined : c[0];
				if(lang && !isChild) micrio.lang = lang;
			}
		} else if(i.revision) {
			// If current micrio lang not available, set to first available
			const langs = Object.keys(i.revision);
			if(langs.length && langs.indexOf(lang as string) < 0)
				micrio.lang = langs[0];
		}

		// Custom JS/CSS
		const s = i.settings;
		if(s && !s?.noExternals) await Promise.all([
			s.css ? this.loadStyle(s.css.href) : null,
			s.js ? this.loadScript(s.js.href, lang) : null
		].filter(p=>!!p));

		// Calculate levels
		for(let f=i.tileSize; f < Math.max(i.width,i.height); f *= 2, this.levels++) {}
		let max = Math.max(i.width, i.height); do this.dzLevels++; while((max/=2) > 1);
		if(s?.gallery?.archive) this.levels -= 1 - (s.gallery.archiveLayerOffset ?? 0);
		if(!this.noImage) this.thumbSrc = this.getTileSrc(this.levels, 0, 0);

		micrio.events.dispatch('pre-info', i);

		if(this.isV5 && i.revision != undefined && !this.opts.isEmbed)
			await this.loadData();

		// For pre-5.0 Micrios
		else if(!i.settings?.skipMeta && !this.opts.isEmbed && !this.isV5) micrio._lang.subscribe((lang?:string) => {
			if(lang && this.id && (!('cultures' in this.__info) || (this.__info.cultures as string || '').split(',').indexOf(lang) < 0)) lang = undefined;
			this.data.set(undefined);
			if(!lang && this.preset?.[2]) lang = 'preset';
			if((lang) && this.id) {
				if(this.preset?.[2]) this.enrichData(this.preset[2])
					.then(d => { this.data.set(d); if(this.preset?.[2]) this.preset[2] = undefined; });
				else fetchJson<Models.ImageData.ImageData>(this.dataPath+this.id+'/data.'+lang+'.json')
					.catch(() => {}).then((d) => d && this.enrichData(d).then(nd => this.data.update(d => {
						deepCopy(nd, d ? d : (d={}), {mergeArrays: true});
						return d;
					})));
			}
		});

		// If it has a full-image linked split screen and main image
		if(i.settings?.micrioSplitLink && !this.opts.secondaryTo) {
			micrio.open({
				id: i.settings.micrioSplitLink,
				settings: { hookEvents: i.settings.secondaryInteractive !== false }
			}, {
				splitScreen: true,
				isPassive: !i.settings.noFollow
			})
		}

		if(i.settings) this.settings.set(i.settings);
		delete i.settings;

		if(this.isOmni) this.state.hookOmni();

		return i;
	}

	/** @internal */
	_loadedData:boolean = false;
	/** Load data
	 * @internal
	*/
	private async loadData() : Promise<void> {
		const skipMeta = this.$settings?.skipMeta || this.__info.settings?.skipMeta;
		if(this._loadedData || skipMeta) return Promise.resolve();
		this._loadedData = true;
		const data = this.preset?.[2] ?? (this.isV5 && await fetchJson<Models.ImageData.ImageData>(this.dataPath+this.id+'/data/pub.json').catch(() => {}));
		if(data) this.enrichData(data).then(d => this.data.set(d));
	}

	/** Get tile src
	 * @internal
	 * @param layer The layer index
	 * @param x The tile X coordinate
	 * @param y The tile Y coordinate
	 * @returns The tile image src
	 */
	getTileSrc(layer:number, x:number, y:number, frame?:number) : string|undefined {
		const i = this.__info;
		if(!i) return;

		if(i.isDeepZoom) layer = this.dzLevels - layer;

		if(i.isIIIF) {
			const s = i.tileSize;
			const ts = Math.pow(2, layer) * s;
			const left = Math.min(i.width, x * ts);
			const top = Math.min(i.height, y * ts);
			return `${i.path}/${i.id}/${[
				left,
				top,
				Math.min(i.width-left, ts),
				Math.min(i.height-top, ts)
			].join(',')}/${[
				Math.round(Math.min(s, (i.width - (ts * x)) / ts * s)),
				Math.round(Math.min(s, (i.height - (ts * y)) / ts * s))
			].join(',')}/0/default.jpg`;
		}

		if(i.settings?._360?.video?.src)
			throw 'Video thumb';

		return `${this.tileBase}${i.tilesId||i.id}/${frame !== undefined ? frame + '/' : ''}${layer}/${x}${i.isDeepZoom?'_':'-'}${y}.${this.extension}`;
	}

	private loadScript(s:string, lang:string='') : Promise<void> { return new Promise((ok:() => void) => {
		if(jsCss.indexOf(s) >= 0 || document.querySelector('script[src="'+s+'"]')) ok();
		else { jsCss.push(s);
			const _el = document.createElement('script'); _el.type = 'text/javascript';
			_el.async = true; _el.defer = true;
			/** @ts-ignore -- used for custom JS to have a cool self reference */
			_el['micrioElement'] = this;
			_el.src = s.replace('$lang', lang); _el.onload = ok; document.head.appendChild(_el);
		}
	})}

	private loadStyle(s:string) : Promise<void> { return new Promise((ok:() => void) => {
		if(jsCss.indexOf(s) >= 0 || document.head.querySelector('link[href="'+s+'"]')) ok();
		else { jsCss.push(s);
			const _el = document.createElement('link'); _el.setAttribute('type', 'text/css');
			_el.setAttribute('rel', 'stylesheet'); _el.setAttribute('href', s);
			_el.onload = ok; document.head.appendChild(_el);
		}
	})}

	/** Enrich marker tour data with external tour step info and durations
	 * This method is called BEFORE Image.data is set. So that's pretty neat.
	*/
	private async enrichData(d:Models.ImageData.ImageData) : Promise<Models.ImageData.ImageData> {
		if(!d) return d;
		/** @ts-ignore */
		if('error' in d) this.__info.error = (d['status'] as string) == '403' ? 'Could not load image data. Are you logged in and do you have the right credentials?' : (d['error'] as string);

		const lang = this.wasm.micrio.lang;

		const micIds:string[] = []

		d.markers?.forEach(m => {
			sanitizeMarker(m, this.is360, !this.isV5);

			// Also check for markers opening a split screen deeplink
			if(m.data?.micrioSplitLink) {
				const split = m.data.micrioSplitLink.split(',').map(s => s.trim());
				const l = m.data._micrioSplitLink = {
					micrioId: split[0],
					markerId: split[1],
					follows: !!split[2] && split[2] != 'false'
				};
				if(l.markerId) micIds.push(l.micrioId);
			}

		})

		if(d.markerTours?.length) micIds.push(...[].concat.apply([],
			/** @ts-ignore */
			d.markerTours.map(t => t.steps)).map((s:string) => s.split(',')[1]).filter((s:string) => !!s && s != this.id)
		);

		const micIdsUnique:string[] = micIds.filter((id,i) => micIds.indexOf(id)==i);

		// Preload all info jsons, but don't have to wait for it
		Promise.all(micIdsUnique.map(id => fetchInfo(id, this.infoBasePath)));

		const getDataPath = (id:string) : string =>
			this.dataPath+(!this.isV5 ? id+'/data.'+lang+'.json' : id+'/data/pub.json');

		// Preload all image data
		const micData = await Promise.all(micIdsUnique.map(
			id => fetchJson<Models.ImageData.ImageData>(getDataPath(id))));

		micData.forEach((d,i) => d?.markers?.forEach(m => sanitizeMarker(m, this.is360, micIdsUnique[i]!.length == 5)));

		const spaceData = this.wasm.micrio.spaceData;

		if(d.markerTours) {
			await Promise.all(d.markerTours.map(t => loadSerialTour(this, t, lang, d)));

			// Filter out all serial tours
			if(spaceData) d.markerTours = d.markerTours.filter(t => !t.steps.find(s => s.includes(',')));
		}

		if(spaceData?.markerTours) await Promise.all(spaceData.markerTours.filter(t => !t.stepInfo).map(t => loadSerialTour(this, t, lang, d)));

		// Also fill the split data with the viewport of target markers
		d.markers?.forEach(m => {
			if(!m.data?._micrioSplitLink) return;
			const targetId = m.data?._micrioSplitLink?.markerId;
			if(targetId) for(let i=0;i<micData.length;i++) {
				const target = micData[i]?.markers?.find(sm => sm.id == targetId);
				if(target) {
					m.data._micrioSplitLink.view = target.view;
					return;
				}
			}
		});

		// Allow data manipulation at this point
		this.wasm.micrio.events.dispatch('pre-data', {
			[this.id]: d,
			...Object.fromEntries(micIdsUnique.map((id,i) => [id, micData[i]]))
		});

		// If other images already initialized but without .$data, set it
		micData.forEach((d,i) => { if(d) {
			const image = this.wasm.images.find(m => m.id == micIdsUnique[i]);
			if(image && image instanceof MicrioImage && !image.$data && !isFetching(getDataPath(image.id)))
				image.data.set(d);
		}});

		return d;
	}

	private parseIIIFSequence(i:Models.ImageInfo.ImageInfo, isIIIFSequence:boolean=false) : void {
		const s = i.sequences?.[0];
		if(!s) return;
		const vertical = s.viewingDirection == 'top-to-bottom'
		const images = s.canvases.map(c => c.images[0]).map(i => i.resource);
		this.noImage = true;
		i.width = !vertical ? images.reduce((v, i) => v+i.width, 0) : Math.max(...images.map(i => i.width));
		i.height = vertical ? images.reduce((v, i) => v+i.height, 0) : Math.max(...images.map(i => i.height));
		let offset = 0;
		let canvas = this.embeds;
		if(!i.settings) i.settings = {};
		if(isIIIFSequence && images.length > 10) {
			canvas = i.gallery = [];
			if(!i.settings.gallery) i.settings.gallery = {};
		}
		images.forEach(s => {
			const margins = [
				(1 - (s.width / i.width)) / 2,
				(1 - (s.height / i.height)) / 2
			];
			canvas.push(new MicrioImage(this.wasm, {
				id: s.service['@id'],
				width: s.width,
				height: s.height,
				isPng: s.format == 'image/png',
				settings: {}
			}, {
				area: vertical ? [margins[0], offset/i.height, 1-margins[0], (offset+s.height)/i.height]
					: [offset/i.width, margins[1], (offset+s.width)/i.width, 1-margins[1] ]
			}));
			offset+=vertical?s.height:s.width;
		});
	}

	/** Add an in-image micrio embed */
	addEmbed(info:Partial<Models.ImageInfo.ImageInfo>, area:Models.Camera.View, opts:Models.Embeds.EmbedOptions = {}) : MicrioImage {
		const a = area.slice(0), img = new MicrioImage(this.wasm, info, {area:a, isEmbed: true, useParentCamera: opts.asImage});
		// When no camera is inited (opts.useParentCamera), set the embed cam to be this camera
		if(!img.camera) img.camera = this.camera;
		this.embeds.push(img);
		if(opts.opacity === undefined) opts.opacity = 1;
		once(img.info).then((i) => { if(!i) return;
			if(opts.fit == 'cover' || opts.fit == 'contain') {
				const yS = this.is360 ? 2 : 1, isCover = opts.fit == 'cover',
					aW = a[2]-a[0], aH = a[3] - a[1], cX = a[0] + aW/2, cY = a[1] + aH/2,
					aAr = aW / aH * yS, imgAr = i.width / i.height;
				if((isCover && imgAr < aAr) || (!isCover && imgAr >= aAr)) {
					const nH = aW / imgAr * yS; a[1] = cY - nH/2; a[3] = cY + nH/2;
				} else { const nW = aH * imgAr / yS; a[0] = cX - nW/2; a[2] = cX + nW/2; }
			}
			this.wasm.addEmbed(img, this, opts);
			this.wasm.render();
		});
		return img;
	}

	/** @internal */
	private embedElements:Map<string, HTMLMediaElement> = new Map();

	/** @internal */
	setEmbedMediaElement(id:string, el?:HTMLMediaElement) : void {
		if(el) this.embedElements.set(id, el);
		else this.embedElements.delete(id);
	}

	/** Get the accompanying HTMLMediaElement for any in-image video embeds */
	getEmbedMediaElement(id:string) : HTMLMediaElement|undefined {
		return this.embedElements.get(id);
	}

	/** @internal */
	splitStart() : void {
		const p = this.wasm.micrio.canvas.viewport.portrait;
		this.opts.secondaryTo?.camera.setArea(p ? [0,0,1,.5] : [0,0,.5,1], {noRender:true});
		this.camera.setArea(p ? [0,.5,1,1] : [.5,0,1,1], {noRender:true});
		this.camera.setView(this.__info?.settings?.view ?? [0,0,1,1])
		this.wasm.render();
	}

	/** @internal */
	splitEnd() : void {
		const a = this.opts.area;
		if(!a) return;
		const w = a[2]-a[0], h = a[3]-a[1];
		if(Math.round(w * 1000)/1000 == 0 || Math.round(h * 1000)/1000 == 0) return;
		const p = w > h;
		this.camera.setArea(p ? [0,1,1,1] : [1,0,1,1], {noRender:true});
		// If main image not animating already, or if not part of grid
		if(!this.opts.secondaryTo?.grid || !this.opts.secondaryTo.camera.aniDone)
			this.opts.secondaryTo?.camera.setArea([0,0,1,1], {noRender:true});
		this.wasm.render();
	}

	/** Fade in the individual image */
	fadeIn(direct:boolean=false) : void {
		this.wasm.fadeImage(this.ptr, 1, direct);
		this.wasm.render();
	}

	fadeOut(direct:boolean=false) : void {
		this.wasm.fadeImage(this.ptr, 0, direct);
		this.wasm.render();
	}

}
