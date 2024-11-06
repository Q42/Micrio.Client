

import type { Writable } from 'svelte/store';
import type { Models } from '../types/models';
import type { Camera } from './camera';
import type Svelte from '../svelte/Main.svelte';

import { once, deepCopy, fetchJson, jsonCache, fetchInfo, fetchAlbumInfo, idIsV5 } from './utils';
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
import { SvelteComponent, tick } from 'svelte';
import { Canvas } from './canvas';
import { rtlLanguageCodes } from './langs';
import { i18n, langs } from './i18n';

/**
 * [[include:./ts/element.md]]
 * @author Marcel Duin <marcel@micr.io>
*/
export class HTMLMicrioElement extends HTMLElement {
	static get observedAttributes() { return ['id', 'muted', 'data-grid', 'data-limited', 'lang']; }

	/** Dynamic Svelte constructor, defaults to Viewer
	 * @internal
	*/
	static Svelte:typeof Svelte;

	/** The Micrio library version number */
	static VERSION:string;

	/** Downloaded JSON files cache store */
	static jsonCache = jsonCache;

	/** Image has been printed
	 * @internal
	*/
	private printed:boolean = false;

	/** All available canvases */
	readonly canvases: MicrioImage[] = [];

	/** Current main {@link MicrioImage} store Writable. Its value can be referred to using the {@link $current} property */
	readonly current:Writable<MicrioImage|undefined> = writable();

	/** Currently visible canvases */
	readonly visible:Writable<MicrioImage[]> = writable([]);

	/** Internal current image
	 * @internal
	*/
	_current:MicrioImage|undefined;

	/** The current active and shown {@link MicrioImage}, returning the current value of the {@link current} store Writable
	 * @readonly
	*/
	get $current():MicrioImage|undefined {return this._current}

	/** The virtual camera instance to control the current main image views */
	get camera():Camera|undefined {return this._current?.camera}

	/** The Micrio sizing and `<canvas>` controller */
	public readonly canvas:Canvas = new Canvas(this);

	/** User input browser event handlers */
	public readonly events:Events = new Events(this);

	/** The main state manager. Read more about it in the {@link State} section.*/
	public readonly state:State.Main = new State.Main(this);

	/** Google analytics plugin */
	private readonly analytics:GoogleTag = new GoogleTag(this);

	/** Router */
	private readonly _router:Router = new Router(this);

	/** Barebone texture downloading, uglier but less bandwidth */
	readonly barebone:Writable<boolean> = writable(false);

	/** The WebGL controller
	 * @internal
	*/
	readonly webgl:WebGL = new WebGL(this);

	/** The WebAssembly controller
	 * @internal
	*/
	readonly wasm:Wasm = new Wasm(this);

	/** The svelte UI instance
	 * @internal
	*/
	_ui:Svelte & SvelteComponent|undefined;

	/** Custom settings, if specified, this overwrites any server received data */
	public defaultSettings?:Partial<Models.ImageInfo.Settings> = this.defaultSettings;

	/** Loading state
	 * @internal
	*/
	readonly loading:Writable<boolean> = writable(true);

	/** Is navigating between images state
	 * @internal
	*/
	readonly switching:Writable<boolean> = writable(false);

	/** Muted state
	 * @internal
	*/
	readonly isMuted:Writable<boolean> = writable(localStorage.getItem(localStorageKeys.globalMuted) == '1')

	/** The current data language Writable
	 * @internal
	*/
	readonly _lang: Writable<string> = writable();

	/** 360 tour Space data */
	spaceData:Models.Spaces.Space|undefined;

	/** Always request new frame
	 * @internal
	*/
	keepRendering: boolean = false;

	/** @internal */
	constructor(){
		super();

		this.current.subscribe(c => this._current = c);

		let shown = false;

		once<boolean>(this.loading, {targetValue: false}).then(() => {
			this.setAttribute('data-loaded','');

			this.switching.subscribe(s => {
				if(s) this.setAttribute('data-switching','');
				else {
					if(!shown) tick().then(() => this.events.dispatch('show', this));
					this.removeAttribute('data-switching');
				}
			});

			// Remove preview image from i.micr.io
			const img = this.querySelector('img.preview');
			if(img) setTimeout(() => img.remove(), 500);
		});
	}

	/** Watch ID attribute
	 * @internal
	*/
	attributeChangedCallback(attr:string, oldVal:string, newVal:string) {
		switch(attr) {
			case 'id': {
				if(!this.isConnected || !newVal) return;
				if(!this.printed) this.print();
				else this.open(newVal);
			} break;
			case 'muted':
				this.isMuted.set(newVal!==null);
				break;
			case 'data-grid':
				if(!this.printed) this.print();
				else this.$current?.grid?.set(newVal);
				break;
			case 'data-limited':
				if(this.wasm?._vertexBuffer && this.$current?.ptr)
					this.wasm.e._setLimited(this.$current.ptr, !!newVal);
				break;
			case 'lang':
				let prevLang = get(this._lang);
				if(prevLang != newVal) {
					this._lang.set(newVal);
					i18n.set(langs[newVal] ?? langs.en);
					if(newVal) {
						if(rtlLanguageCodes.indexOf(newVal) >= 0) this.setAttribute('dir', 'rtl');
						else this.removeAttribute('dir');
					}
					if(prevLang) this.events.dispatch('lang-switch', newVal);
				}
				break;
		}
	}

	/** When ID is already set but wasn't in DOM yet
	 * @internal
	*/
	connectedCallback() : void {
		this.canvas.place();
		if((this.hasAttribute('data-router') || this.hasAttribute('data-space'))
			&& this.getAttribute('data-router') != 'false') this._router.hook();
		if((this.id || this.hasAttribute('data-gallery')) && !this.printed) this.print();
		if(!('muted' in this)) {
			Object.defineProperty(this, 'muted', {
				get() { return get(this.isMuted) },
				set(b:boolean) { if(b) this.setAttribute('muted',''); else this.removeAttribute('muted'); }
			});
			this.isMuted.subscribe(b => {
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
			})
		}
	}

	/** Destroy the Micrio instance and free up all memory */
	destroy() : void {
		this.current.set(undefined);
		this._router.unhook();
		this.events.enabled.set(false);
		this.canvas.unhook();
		this.analytics.unhook();
		this.wasm.unbind();
		if(this._ui) this._ui?.$destroy();
		delete this._ui;
		this.printed = false;
	}

	/** @internal */
	private loadArchiveBin(path:string, id:string) : Promise<void> {
		this.printUI(true, true);
		return archive.load(path, 'g/'+id, p => this._ui?.$set({loadingProgress: p}));
	}

	/** @internal */
	private loadV5Album = (id:string, opts:Partial<Models.ImageInfo.ImageInfo>) : Promise<void> => fetchAlbumInfo(id).then((aInfo) => {
		if(!aInfo) return;
		const archive = aInfo.id+'.'+aInfo.revision;
		const path = opts.path = aInfo.organisation?.baseUrl ?? BASEPATH_V5;
		opts.organisation = aInfo.organisation;
		opts.settings!.album = aInfo;
		opts.settings!.gallery = {
			archive,
			sort: aInfo.sort,
			type: aInfo.type,
			startId: opts.id,
			isSpreads: aInfo.isSpreads,
			coverPages: aInfo.coverPages,
			revisions: aInfo.published
		};
		delete opts.id;
		return this.loadArchiveBin(path, archive)
			.then(() => this.loadGallery(opts, path, true));
	}, (e) => this.printError(e?.message || e));

	/** Print/update main image
	 * @internal
	*/
	private async print() : Promise<void> {
		if(this.printed) return;
		this.printed = true;
		await tick();
		const opts = this.getOptions();
		if(!opts.settings) opts.settings = {};
		if(opts.settings.noControls) this.state.ui.controls.set(false);

		if(opts.settings.gallery?.archive) {
			const gallery = opts.settings.gallery?.archive;
			const isArchive = /\.\d+$/.test(gallery);
			const path = opts.path||(idIsV5(gallery.replace(/\.\d+$/,'')) ? BASEPATH_V5 : BASEPATH);
			if(isArchive) await this.loadArchiveBin(path, gallery);
			opts.settings.gallery.startId = opts.id;
			if(opts.grid) await this.setGrid(opts, path);
			else await this.loadGallery(opts, path, isArchive);
			if(!isArchive) delete opts.settings.gallery.archive;
			if(!opts.path) opts.path = path;
			delete opts.id;
		}
		else if(opts.id?.startsWith('album/')) await this.loadV5Album(opts.id.replace('album/', ''), opts);
		else if(opts.id && idIsV5(opts.id) && !this.hasAttribute('width') && !this.hasAttribute('height')) await fetchInfo(opts.id, opts.forceInfoPath ? opts.path : undefined).then(i => i?.albumId ? this.loadV5Album(i.albumId, opts) : undefined);

		this.keepRendering = !!opts.settings.keepRendering;
		const doOpen = opts.id || opts.gallery || opts.grid;
		this.events.dispatch('print', opts);
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

	private printUI(noHTML:boolean, noLogo:boolean) : void {
		/* @ts-ignore */
		if(!this._ui) this._ui = new HTMLMicrioElement.Svelte({target:this, props:{micrio:this,noHTML,noLogo}})
		else this._ui.$set({noLogo, noHTML});
	}

	/** @internal */
	printError(str?:string) : void {
		this._ui?.$set({error: str??'An unknown error has occurred'});
	}

	/** Open a Micrio image by ID or {@link Models.ImageInfo.ImageInfo} JSON data
	 * @param idOrInfo An image ID or a {@link Models.ImageInfo.ImageInfo} JSON object
	 * @param opts Some opening parameters
	*/
	open(idOrInfo:string|Partial<Models.ImageInfo.ImageInfo>, opts:{
		/** Don't focus on an image inside the grid, keep the grid active */
		gridView?: boolean,
		/** Open the image as a secondary split screen image */
		splitScreen?: boolean,
		/** Optional image that is the lead image for split screen */
		splitTo?: MicrioImage,
		/** Passive split screen */
		isPassive?: boolean,
		/** Optional start view */
		startView?: Models.Camera.View,
		/** In case of 360, move into this direction */
		vector?: Models.Camera.Vector,
	}={}) : MicrioImage {
		if(!this.printed) this.print();
		const isId = typeof idOrInfo == 'string';
		const attrOpts = this.getOptions();
		// If is only ID, use the attribute options for settings
		let i:Partial<Models.ImageInfo.ImageInfo> = isId ? {...attrOpts, id:idOrInfo} : idOrInfo;
		// Always enrich info with attributes
		if(this.$current && i.id == this.$current?.id) return this.$current;
		if(!i.settings) i.settings = {};
		if(attrOpts.settings?.gallery?.archive) if(!/\.\d+$/.test(attrOpts.settings.gallery.archive)) delete attrOpts.settings.gallery.archive;
		if(!isId) deepCopy(attrOpts.settings, i.settings);
		if(this.defaultSettings) deepCopy(this.defaultSettings, i.settings);
		if(!opts.splitScreen && !opts.gridView && this.$current) this.switching.set(true);
		if(!i.settings.noGTag) this.analytics.hook();
		this.printed = true;
		this.printUI(!!i.settings.noUI, !!i.settings.noLogo);
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

			this.canvases.push(c = new MicrioImage(this.wasm, i, opts.splitScreen ? { secondaryTo: opts.splitTo ?? this._current, isPassive: opts.isPassive } : undefined));

			// If not already loaded but available state json, set already
			const state = this.state.value && this.state.value.c.find(c => c[0] == i.id);
			if(state) c.state.set(state);

		}

		// Force a start view
		if(opts.startView) {
			c.state.view.set(i.settings.view = opts.startView);
			if(c.ptr && c.camera.e) c.camera.setView(i.settings.view,{noRender:true});
		}

		// Set default language -- this also updates this._lang
		if(!this.lang) this.lang = 'en';

		const setImage = () => { if(!c) return;
			// For loading
			once(c.info).then(i => { if(!i || !c) return;
				// Do this once
				if(!this.webgl.gl) {
					this.webgl.init();
					this.canvas.hook();

					// Set dark/light mode
					switch(i.settings?.theme) {
						case 'light': this.setAttribute('data-light-mode',''); break;
						case 'os': this.setAttribute('data-auto-scheme',''); break;
					}
				}

				if(i.grid && !c.grid) c.grid = new Grid(this, c);

				tick().then(() => this.dispatchEvent(new CustomEvent('load', {detail: c})));

				if(opts.splitScreen) tick().then(() => { if(!c) return;
					// If in grid and is animating
					if(grid?.image.camera.aniDone)
						grid.image.camera.aniDoneAdd.push(() => c?.splitStart());
					else c.splitStart();
				});

			});

			// For 360 navigation
			this.wasm.e.set360Orientation(this.wasm.getPtr(),
				opts.vector?.direction ?? 0,
				opts.vector?.distanceX ?? 0,
				opts.vector?.distanceY ?? 0);

			// Set 360 direction because waypoint was used
			this.wasm.preventDirectionSet = !opts.vector;

			if(isInGrid && (!opts.gridView || !grid?.current.find(img => img.id == i.id)))
				grid?.focus(c, {view: i.settings?.view}).then(() => this.current.set(c));
			else if(!opts.splitScreen) this.current.set(c);
			else this.wasm.setCanvas(c);
		}

		if(!this.wasm.ready) this.wasm.load().then(setImage);
		else setImage();

		if(c.noImage) this.loading.set(false);

		return c;
	}

	/** Close an opened MicrioImage
	 * @param img The currently visible {@link MicrioImage}
	*/
	close(img:MicrioImage) : void {
		if(img.opts.secondaryTo) img.splitEnd();
		else this.wasm.removeCanvas(img);
	}

	/** Parse the HTML attribute to Micrio Options
	 * @internal
	*/
	private getOptions(): Partial<Models.ImageInfo.ImageInfo> {
		const sets:Partial<Models.ImageInfo.Settings> = {
			gallery: {}
		};

		const opts:Partial<Models.ImageInfo.ImageInfo> = {
			settings: sets as Models.ImageInfo.Settings,
			id: this.id
		};

		const setObj = (b:any, f:string, val:any) : void => {
			const p = f.split('.');
			for(let i=0;i<p.length-1;i++) b = b[p[i]];
			b[p[p.length-1]]=val;
		}

		for(const a in AO.STRINGS) {
			const o = AO.STRINGS[a], val = this.getAttribute(a), f = o.f || a.replace('data-', '');
			if(val) setObj(o.r?opts:sets, f, val);
		}
		for(const a in AO.BOOLEANS) {
			const o = AO.BOOLEANS[a], val = this.getAttribute(a), f = o.f || a.replace('data-', '');
			const tr = val!=undefined&&val==''||val=='true';
			if(tr || val=='false') setObj(o.r?opts:sets,f,o.n ? !tr : !!tr);
		}
		for(const a in AO.NUMBERS) {
			const o = AO.NUMBERS[a], f = o.f || a.replace('data-', '');
			let val = this.getAttribute(a);
			if(o.dN !== undefined && val == null) val = o.dN;
			if(val != undefined && !isNaN(Number(val))) setObj(o.r ? opts : sets,f,Number(val));
		}
		for(const a in AO.ARRAYS) {
			const o = AO.ARRAYS[a], val = this.getAttribute(a), f = o.f || a.replace('data-', '');
			if(val != undefined) setObj(o.r ? opts : sets,f,val.split(',').map(s => Number(s)));
		}

		if(sets.static) {
			sets.noUI = sets.skipMeta = true;
			sets.hookEvents = false;
		}

		if(opts.settings && opts.grid && opts.grid.indexOf('.') > 0) opts.settings.gallery!.archive = opts.grid;

		return opts;
	}

	private async loadGallery(opts:Partial<Models.ImageInfo.ImageInfo>, path:string, isArchive:boolean) : Promise<void> {
		let gallery = opts.settings?.gallery;
		let archive = gallery?.archive;
		if(!gallery || !archive) return;
		const sets = opts.settings!;
		if(isArchive) {
			const index = await this.getArchiveIndex(archive.split('.')[0], path);
			gallery.archiveLayerOffset = index.delta;
			archive = index.images.sort(
				gallery.sort == 'name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0
				: gallery.sort == '-name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? 1 : a.title > b.title ? -1 : 0
				: gallery.sort == '-created' ? (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? 1 : a.created > b.created ? -1 : 0
				: (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? -1 : a.created > b.created ? 1 : 0
				).map(i => `${i.id},${i.width},${i.height},${i.isDeepZoom?'d':''},${i.isPng ? 'p' : i.isWebP ? 'w' : ''},${i.tileSize || ''}`.replace(/\,+$/,''))
				.join(';');
		}
		const entries = archive.split(';').map(t => t.trim());
		if(!isArchive) {
			const promises = entries.filter(t => t.startsWith('http')).map(u => fetchJson<Partial<Models.ImageInfo.ImageInfo>>(u));
			if(promises.length) await Promise.all(promises).then(r => r.forEach((d, i:number) => { if(!d) return;
				/** @ts-ignore */
				entries[i] = `${d['@id']},${d.width},${d.height}`;
			}));
		}
		const pages = entries.map((e:string) : any[] => e.split(',')
			.map((v:any) => isNaN(v) ? v : Number(v)));
		pages.forEach((p,i) => { if(i>0&&!p[2]) p.push(...pages[i-1].slice(1)) });
		const h = opts.height = Math.max(...pages.map(p => p[2]));
		if(!gallery.type) gallery.type = 'swipe';
		const isSwitch = gallery.type == 'switch' || gallery.type == 'swipe-full' || gallery.type == 'omni';
		const isSpreads = gallery.isSpreads;
		const marginX = isSpreads && !isSwitch ? Math.round(pages[0][1] / 20) : 0;
		const coverPages = isSpreads ? gallery.coverPages ?? 0 : 0;
		const w = opts.width = isSwitch ? Math.max(...pages.map(p => p[1] * (isSpreads ? 2 : 1))) : pages.reduce((w, c) => w + c[1] + marginX, 0);
		let l=0;
		opts.gallery = pages.map((c,i) => new MicrioImage(this.wasm, {id: c[0], path,
			width: c[1], height: c[2], isDeepZoom: c[3] == 'd', isPng: c[4] == 'p', isWebP: c[4] == 'w', tileSize: c[5]||1024,
			revision: gallery?.revisions?.[c[0]],
			settings: { skipMeta: true, gallery }}, {
				isEmbed: isSwitch,
				useParentCamera: isSwitch,
				area: isSwitch ? !isSpreads ? [0,0,1,1]
					: i-coverPages < 0 || (i == pages.length-1 && i%2==0) ? [0.25,0,0.75,1] : (i-coverPages)%2==0 ? [0,0,.5,1] : [.5,0,1,1]
					: [(l+=i>0&&((i<coverPages)||(i-coverPages)%2==0)?marginX:0)/w,(h-c[2])/2/h,(l+=c[1])/w,((h-c[2])/2+c[2])/h]
			})
		);
		sets.pinchZoomOutLimit = true;
		if(opts.gallery.length) sets.view = opts.gallery[Math.max(0, opts.gallery.findIndex(i => i.id == gallery!.startId))].opts.area;
	}

	gridInfoData:{images: Models.ImageInfo.ImageInfo[]}|undefined;
	private async setGrid(opts:Partial<Models.ImageInfo.ImageInfo>, path:string) : Promise<void> {
		if(!opts.settings || !opts.grid) return;
		if(opts.settings.gallery?.archive == opts.grid)
			opts.grid = ((this.gridInfoData=await this.getArchiveIndex(opts.grid.split('.')[0], path))).images.map(i =>
				Grid.getString(i, {cultures: 'cultures' in i ? (<unknown>i.cultures as string[]).join('-') : undefined})
			).join(';');
		opts.width = this.offsetWidth * this.canvas.getRatio();
		opts.height = this.offsetHeight * this.canvas.getRatio();
		opts.settings.zoomLimit = 15;
		opts.settings.minimap = false;
		opts.settings.initType = 'cover';
		this.removeAttribute('data-grid');
	}

	private getArchiveIndex = async (id:string,path:string=BASEPATH) : Promise<{delta?:number; images: Models.ImageInfo.ImageInfo[]}> =>
		archive.get<{images: Models.ImageInfo.ImageInfo[]}>(`${path}${id}.json`)
			.then(r => { r.images.forEach(i => jsonCache.set(`${path}${i.id}/info.json`, i)); return r });
}
