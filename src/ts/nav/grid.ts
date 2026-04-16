/**
 * Micrio grid display controller
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$ts/element';

import { MicrioImage } from '$ts/image';
import { get, writable, type Unsubscriber, type Writable } from 'svelte/store';
import { deepCopy, once, sleep } from '$ts/utils';
import { tick } from 'svelte';
import { Enums } from '$ts/enums';

/** Rounds a number to 5 decimal places. @internal */
const round = (n:number) => Math.round(n*100000)/100000;

/** Slide transition entry areas by direction. @internal */
const slideAreas: Record<number, Models.Camera.ViewRect> = {
	0:   [0, -.5, 1, 0],
	90:  [1, 0, 1.5, 1],
	180: [0, 1, 1, 1.5],
	270: [-.5, 0, 0, 1],
};

/** Swipe transition entry areas by direction. @internal */
const swipeAreas: Record<number, Models.Camera.ViewRect> = {
	0:   [0, -1, 1, 0],
	90:  [1, 0, 2, 1],
	180: [0, 1, 1, 2],
	270: [-1, 0, 0, 1],
};

/** Swipe transition exit areas by direction (inverse of entry). @internal */
const swipeExitAreas: Record<number, Models.Camera.ViewRect> = {
	0:   [0, 1, 1, 2],
	90:  [-1, 0, 0, 1],
	180: [0, -1, 1, 0],
	270: [1, 0, 2, 1],
};

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
		view?:Models.Camera.View;
		area?:Models.Camera.ViewRect;
		size?:number[];
		cultures?: string;
	}) : string => [
		i.id,
		i.width,
		i.height,
		i.isDeepZoom ? 'd' : '',
		i.isPng ? 'p':i.isWebP ? 'w' : '',
		opts.view?.map(round).join('/'),
		opts.area?.map(round).join('/'),
		i.settings?.focus?.map(round).join('-'),
		opts.cultures
	].join(',').replace(/,+$/,'')+(opts.size? `|${opts.size.join(',')}`:'');

	/** Array of {@link MicrioImage} instances currently part of the grid definition (loaded). */
	readonly images:MicrioImage[] = [];

	/** O(1) lookup map for images by ID, kept in sync with {@link images}. @internal */
	private readonly imageMap:Map<string, MicrioImage> = new Map();

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
	private _to:ReturnType<typeof setTimeout>|undefined;
	/** Timeout ID specifically for fade-in animations during transitions. @internal */
	private _fadeTo:ReturnType<typeof setTimeout>|undefined;
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
		this.tourEvent = this.tourEvent.bind(this);
		this.updateGrid = this.updateGrid.bind(this);

		const s = image.$settings;
		this.clickable = !!s.gridClickable;
		if(s.gridTransitionDuration !== undefined) this.aniDurationIn = this.aniDurationOut = s.gridTransitionDuration;
		if(s.gridTransitionDurationOut !== undefined) this.aniDurationOut = s.gridTransitionDurationOut;

		this._grid.className = 'micrio-grid';
		this.set(image.$info?.grid);

		const loaded = () => tick().then(() => {
			this.hook();
			micrio.events.dispatch('grid-load');
		});

		if(!image.isV5) micrio._lang.subscribe(l => {
			if(l) Promise.all(this.images.filter(i => (i.$info && 'cultures' in i.$info && i.$info?.cultures as string || '').indexOf(l) >= 0).map(i => once(i.data))).then(loaded);
			else loaded();
		});
		else {
			loaded();
		}

		micrio.events.dispatch('grid-init', this);
	}

	/** Hooks necessary event listeners for grid interactions. @internal */
	private hook() {
		this.micrio.state.marker.subscribe(m => {
			if(m && typeof m != 'string') {
				const d = m.data?._meta;
				if(d?.gridSize) {
					const s = (typeof d.gridSize == 'number' ? [d.gridSize, d.gridSize]
						: d.gridSize.split(',').map(Number)) as [number, number];
					const micId = this.images.find(i => i.$data?.markers?.find(n => n == m))?.id;
					if(micId) this.nextSize.set(micId, s);
				}
				tick().then(() => {
					const a = d?.gridAction?.split('|');
					if(a?.length && typeof a[0] == 'string') this.action(a.shift() as string, a.join('|'));
				})
			}
		});

		if(this.clickable) {
			this._grid.addEventListener('click', e => {
				const id = (e.target as HTMLElement).dataset.id;
				if(id) this.focus(this.imageMap.get(id));
			});

			const placeOrRemove = (t:unknown) => { if(t) this.removeGrid(); else this.placeGrid(); };
			this.micrio.state.tour.subscribe(placeOrRemove);
			this.micrio.state.marker.subscribe(placeOrRemove);
			this.focussed.subscribe(placeOrRemove);
		}

		this.micrio.addEventListener('tour-event', this.tourEvent);
		this.micrio.addEventListener('serialtour-pause', () => this.images.forEach(i => i.camera.pause()));
		this.micrio.addEventListener('serialtour-play', () => this.images.forEach(i => i.camera.resume()));
	}

	/** Clears any pending timeouts for transitions or fades. @internal */
	private clearTimeouts() : void {
		clearTimeout(this._to);
		clearTimeout(this._fadeTo);
	}

	/** Adds a MicrioImage to the images array and lookup map. @internal */
	private trackImage(img: MicrioImage): void {
		this.images.push(img);
		this.imageMap.set(img.id, img);
	}

	/**
	 * Normalizes the set() input into an array of GridImage definitions.
	 * @internal
	 */
	private parseInput(input: string|MicrioImage[]|({image:MicrioImage} & Models.Grid.GridImageOptions)[]): Models.Grid.GridImage[] {
		if(typeof input != 'string')
			input = input.map(i => i instanceof MicrioImage ? {image:i} : i)
			.filter(g => !!g.image.$info).map(g => this.getString(g.image.$info!, g)).join(';');

		return input.split(';').filter(s => !!s).map(s => this.getImage(s));
	}

	/**
	 * Applies transition-specific setup for 'behind' and 'behind-delayed' transitions.
	 * Mutates opts to set forceAni, coverLimit, and forceAreaAni.
	 * @internal
	 */
	private setupBehindTransition(images: Models.Grid.GridImage[], opts: {
		coverLimit?: boolean;
		forceAni?: boolean;
		forceAreaAni?: boolean;
		transition?: Models.Grid.GridSetTransition;
	}, focussed: MicrioImage|undefined): void {
		const isDelayed = opts.transition == 'behind-delayed';
		const isLim = opts.coverLimit === true;
		const { wasm } = this.micrio;
		opts.forceAni = true;
		opts.coverLimit = isLim;
		opts.forceAreaAni = true;
		const vW = isDelayed ? 1/images.length : 1;
		let c = 0;
		this.images.forEach(i => {
			i.camera.setCoverLimit(isLim);
			if(images.find(e => e.id == i.id)) {
				i.camera.setArea([0,0,focussed?.id == i.id ? 1 : vW,1], {noDispatch: true, direct: true});
				if(i != focussed) i.camera.setView([0,0,1,1]);
				if(isDelayed) wasm.setZIndex(i.ptr, images.length-(c++));
			}
		});
		images.forEach(e => e.view = [0,0,1,1]);
	}

	/**
	 * Saves the current layout to the history stack and updates depth.
	 * @internal
	 */
	private savePreviousLayout(): void {
		this.depth.set(this.history.push({
			layout: this.current.map(i => this.getString(i.$info as Models.ImageInfo.ImageInfo, {
				view: i.state.$view,
				size: this.cellSizes.get(i.id) as [number,number]
			})).join(';'),
			horizontal: this.isHorizontal,
			view: this.image.camera.getView()
		}));
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
		noHistory?:boolean;
		keepGrid?: boolean;
		horizontal?:boolean;
		duration?:number;
		view?:Models.Camera.View;
		noCamAni?: boolean;
		forceAreaAni?: boolean;
		noBlur?: boolean;
		noFade?: boolean;
		transition?: Models.Grid.GridSetTransition;
		forceAni?: boolean;
		coverLimit?: boolean;
		cover?: boolean;
		scale?: number;
		columns?: number;
	}={}) : Promise<MicrioImage[]> { return this.lastPromise = new Promise((ok, err) => {
		delete this.image.$info?.settings?.focus;
		this.lastAction = undefined;

		if(opts.cover === false && opts.coverLimit) opts.coverLimit = false;
		if(opts.coverLimit && opts.cover == undefined) opts.cover = opts.coverLimit;

		const images = this.parseInput(input);
		const focussed = this.$focussed;
		const isDelayed = opts.transition?.endsWith('-delayed');
		const isBehindDelay = opts.transition == 'behind-delayed';
		const { wasm } = this.micrio;

		if(opts.transition == 'crossfade') opts.duration = 0;
		else if(opts.transition == 'behind' || opts.transition == 'behind-delayed')
			this.setupBehindTransition(images, opts, focussed);

		const ready = this.image.ptr >= 0;
		const dur = opts.duration ?? (opts.noHistory ? this.aniDurationOut : this.aniDurationIn);
		const defaultDur = this.nextCrossFadeDuration ?? this.image.$settings.crossfadeDuration ?? 1;
		const crossfadeDur = (dur || this.aniDurationIn) / (isBehindDelay ? 2 : 1);
		this.nextCrossFadeDuration = undefined;
		if(ready) {
			wasm.setGridTransitionDuration(dur);
			wasm.setCrossfadeDuration(crossfadeDur);
		}

		const doUnfocus = !opts.noBlur && focussed;
		if(doUnfocus) this.blur();

		if(!opts.noHistory && this.current.length) this.savePreviousLayout();
		this.isHorizontal = !!opts.horizontal;

		this.removeImages(this.images.filter(i => !images.find(n => n.id == i.id)));
		this.printGrid(images, {
			horizontal: opts.horizontal,
			keepGrid: opts.keepGrid,
			scale: opts.scale,
			columns: opts.columns
		});

		this.clearTimeouts();

		let resolved = false;
		const error = () => {
			this.clearTimeouts();
			if(!resolved) err();
		};

		if(ready && !opts.noCamAni) {
			if(opts.view) this.image.camera.flyToView(opts.view, {duration:dur*1000}).catch(error);
			else this.image.camera.flyToFullView({duration:dur*1000}).catch(error);
		}

		this.nextSize.clear();

		if(opts.coverLimit == undefined) opts.coverLimit = true;
		if(!opts.coverLimit) images.forEach(i => this.imageMap.get(i.id!)?.camera.setCoverLimit(false));

		const isAppear = opts.transition == 'appear-delayed';
		const getDelay = (i:number) : number => i * this.transitionDelay + (i > 0 && isAppear ? dur : 0);

		this.current = images.map((img,i) => this.placeImage(img, {
			duration: !opts.forceAni && doUnfocus && img.id != focussed?.id ? 0 : dur,
			delay: isDelayed ? getDelay(i) : 0,
			noCamAni: isAppear && i > 0 ? true : !!opts.noCamAni,
			forceAreaAni: isAppear && i > 0 ? false : opts.forceAreaAni,
			cover: opts.cover
		}));

		if(isAppear) this.current.slice(1).forEach(i => wasm.fadeTo(i.ptr, .9999, true));

		const fadeIn = () => this.current.forEach((img,i) =>
			sleep(isDelayed ? (getDelay(i) + (isBehindDelay ? dur/2 : 0)) * 1000 : 0)
				.then(() => wasm.fadeIn(img.ptr))
		);

		const done = () => {
			this.clearTimeouts();
			requestAnimationFrame(() => wasm.setCrossfadeDuration(defaultDur));
			if(isDelayed) this.images.forEach(i => wasm.setZIndex(i.ptr, 0));
			if(opts.coverLimit) images.forEach(i => this.imageMap.get(i.id!)?.camera.setCoverLimit(true));
			if(this.clickable) this.placeGrid();
			this.lastAction = undefined;
			resolved = true;
			ok(this.current);
		}

		if(!dur && !crossfadeDur) {
			if(!opts.noFade) fadeIn();
			done();
		}
		else {
			if(!opts.noFade) this._fadeTo = setTimeout(fadeIn, Math.max(0, dur / 2 * 1000));
			this._to = setTimeout(done, (Math.max(crossfadeDur, dur) + (isDelayed ? (images.length-1) * this.transitionDelay : 0))*1000);
		}
	})}

	/** Checks if the current grid layout differs from the initial full grid layout. @internal */
	private hasChanged() : boolean {
		if(this.current.length !== this.images.length) return true;
		return this.current.some((img, i) => img.id !== this.images[i].id);
	}

	/**
	 * Parses an individual image grid string into a GridImage object.
	 * @param s The grid string for a single image.
	 * @returns The parsed `Models.Grid.GridImage` object.
	*/
	getImage(s:string) : Models.Grid.GridImage {
		const g = s.split('|'), p = g[0].split(','),
			size = (g[1] ? g[1].split(',').map(Number) : [1])  as [number,number?];
		let width:number=0,height:number=0;

		return {
			path: this.image.$info?.path,
			id: p[0],
			width: width=(Number(p[1])||width),
			height: height=(Number(p[2])||height),
			isDeepZoom: p[3]=='d',
			isPng: p[4]=='p',
			isWebP: p[4]=='w',
			size,
			view: p[5] ? p[5].split('/').map(Number) as Models.Camera.ViewRect : undefined,
			area: p[6] ? p[6].split('/').map(Number) as Models.Camera.ViewRect : undefined,
			settings: deepCopy(this.image.$settings||{}, {
				focus: p[7] ? p[7].split('-').map(Number) as [number, number] : undefined
			}),
			cultures: p[8]?.replace(/-/g,',')||undefined
		} as Models.Grid.GridImage
	}

	/**
	 * Converts an ImageInfo object and options back into the grid string format.
	 * @returns The grid encoded string for this image.
	*/
	getString = (i:Models.ImageInfo.ImageInfo, opts:Models.Grid.GridImageOptions = {}) : string => Grid.getString(i, {
		view: opts.view,
		area: opts.area,
		size: opts.size ?? this.nextSize.get(i.id) as [number,number],
		cultures: ('cultures' in i && i['cultures'] ? i.cultures as string : '')?.replace(/,/g,'-')
	});

	/** Calculates the optimal number of columns for the grid layout. @internal */
	private getCols(images:number, numTiles:number) : number {
		let num = Math.ceil(numTiles / Math.ceil(Math.sqrt(numTiles)));
		if(images == numTiles) {
			const margin = Math.floor(Math.sqrt(images)), cols:number[] = [];
			for(let n = margin; n < num+margin; n++) if(!(images % n)) cols.push(n);
			if(cols.length) num = cols[Math.floor(cols.length / 2)];
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
		if(!opts.keepGrid) this.removeGrid();
		const numTiles = images.reduce((n, i) => n + i.size[0] * (i.size[1] ?? 1), 0);
		const cols = opts.columns ?? (opts.horizontal ? images.length : this.getCols(images.length, numTiles));
		this._grid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
		this._grid.textContent = '';
		this._grid.style.removeProperty('--translate');
		this._grid.style.removeProperty('--scale');

		images.forEach(i => { if(!i.id) return;
			if(!this._buttons.has(i.id)) this._buttons.set(i.id, document.createElement('button'));
			const tile = this._buttons.get(i.id)!;
			if(i.size.toString() != '1') {
				tile.style.gridArea = `auto / auto / span ${i.size[1]} / span ${i.size[0]||i.size[1]}`;
				this.cellSizes.set(i.id, i.size)
			}
			else {
				tile.style.removeProperty('grid-area');
				this.cellSizes.delete(i.id);
			}
			tile.dataset.id = i.id;
			this._grid.appendChild(tile);
		});

		if(!opts.keepGrid || !this._grid.parentNode) this.micrio.insertBefore(this._grid, this.micrio.firstChild?.nextSibling ?? null);

		this.micrio.events.dispatch('grid-layout-set', this);

		const w = this.micrio.offsetWidth;
		const h = this.micrio.offsetHeight;
		const s = Math.max(0, Math.min(1, 1 - (opts.scale??1)));
		this._grid.style.transform = '';
		this._grid.childNodes.forEach((n:ChildNode) => { if(!n) return;
			const e = n as HTMLElement;
			const id = e.dataset.id;
			const r = e.getBoundingClientRect();
			const img = images.find(i => i.id == id);
			const o = [(s/2)*r.width, (s/2)*r.height];
			if(img && !img.area) img.area = [(r.x+o[0])/w, (r.y+o[1])/h, (r.x+r.width-o[0])/w, (r.y+r.height-o[1])/h]
		});

		if(!opts.keepGrid) this._grid.remove();
	}

	/** Places the HTML grid overlay element into the DOM and starts listening for view changes. @internal */
	private placeGrid() : void {
		if(!this.clickable || this.micrio.state.$tour || this.micrio.state.$marker) return;
		if(this._grid.parentNode) return;
		this.micrio.insertBefore(this._grid, this.micrio.firstChild?.nextSibling ?? null);
		this.viewUnsub = this.image.state.view.subscribe(this.updateGrid);
	}

	/** Removes the HTML grid overlay element from the DOM and stops listening for view changes. @internal */
	private removeGrid() : void {
		if(!this._grid.parentNode) return;
		if(this.viewUnsub) this.viewUnsub();
		this._grid.remove();
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
		duration:number;
		delay:number;
		noCamAni?:boolean;
		forceAreaAni?:boolean;
		cover?:boolean;
	}) : MicrioImage {
		const { wasm } = this.micrio;
		let img = this.imageMap.get(entry.id!);
		if(img && entry.area) sleep(opts.delay*1000).then(() => {
			img!.camera.setArea(entry.area!, {
				direct: opts.duration==0 || (!opts.forceAreaAni && !get(img!.visible))
			});
			if(opts.delay) wasm.render();
		});
		else {
			entry.lang = this.micrio.lang;
			wasm.addChild(img = new MicrioImage(wasm, entry, {area: entry.area}), this.image);
			this.trackImage(img);
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

	/** Fade out unused images in the grid and clean up their button references.
	 * @param images The images to hide
	*/
	private removeImages(images:MicrioImage[]) : void {
		const { wasm } = this.micrio;
		images.forEach(i => {
			if(i.ptr >= 0) wasm.fadeOut(i.ptr);
			this._buttons.delete(i.id);
		});
		wasm.render();
	}


	/** Checks whether current viewed image is (part of) grid */
	insideGrid() : boolean {
		const c = this.micrio.$current;
		return c == this.image || (!!c && this.imageMap.has(c.id));
	}

	/** Reset the grid to its initial layout
	 * @param duration Duration in seconds
	 * @param noCamAni Don't do any camera animating
	 * @param forceAni Force animation on all grid images
	 * @returns Promise when the transition is complete
	*/
	async reset(duration?:number, noCamAni?:boolean, forceAni?:boolean) : Promise<MicrioImage[]> {
		const state = this.history[0];
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

	/** Immediately switch back to the initial grid view, maintaining the current view.
	 * Usable only if the grid is perfect N x N.
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
		const images = !name ? this.images : this.images.filter(i => !!i.$data?.markers?.find(m => m.tags?.includes(name)));
		return this.set(images.map(img => {
			const m = img.$data?.markers?.find(m => m.tags?.includes(name));
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
		this.micrio.wasm.setGridTransitionTimingFunction(Enums.Camera.TimingFunction[this.timingFunction=fn]);
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

		if(!get(m.visible).find(i => i == this.image)) m.current.set(this.image);

		const focussed = this.$focussed;

		if(focussed == img) return;

		const direct = !opts.transition?.startsWith('slide-') && (opts.duration == 0 || (focussed && !m.wasm.areaAnimating(focussed.ptr) && !this.current.includes(img)));
		if(direct) img.camera.setArea([0,0,1,1], {noDispatch: true, direct: true});
		if(focussed) this.blur();

		img.camera.setCoverLimit(!!opts.cover);
		this.setTimingFunction('ease');

		const target:string = await this.transition(img, focussed, this.getString(img.$info!, {
			view: opts.view
		}), opts);

		m.wasm.setZIndex(img.ptr, 3);
		this.focussed.set(img);

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

		const { wasm } = this.micrio;

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

		if(isSlwipe || isBehind) wasm.fadeTo(target.ptr, .9999, true);

		if(transition.startsWith('slide')) {
			target.camera.setArea(slideAreas[transDir!], {noDispatch: true, direct: true});
		}
		else if(transition.startsWith('swipe')) {
			target.camera.setArea(swipeAreas[transDir!], {noDispatch: true, direct: true});
			layout = [
				this.getString(current.$info!, {
					view: exitView ?? current.camera.getView(),
					area: swipeExitAreas[transDir!]
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
				this.getString(current.$info!, {view: [0,0,1,1]}),
				this.getString(target.$info!, {view: [0,0,1,1]})
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
		this.micrio.wasm.setZIndex(focussed.ptr, 2);
		this.micrio.events.dispatch('grid-blur');
		this.focussed.set(undefined);
		this.image.camera.setLimit([0, 0, 1, 1]);
		this.micrio.current.set(this.image);
	}

	/** Handles tour events, potentially triggering grid actions. @internal */
	private tourEvent(e:Event) {
		const event = (e as CustomEvent).detail as Models.ImageData.Event;
		if(!event || !event.action?.startsWith('grid:')) return;
		if(event.active) this.action(event.action.slice(5), event.data, event.end - event.start);
	}

	/** Action handler dispatch map, keyed by {@link Enums.Grid.GridActionType}. @internal */
	private readonly actionHandlers: Record<number, (data?: string, duration?: number) => void> = {
		[Enums.Grid.GridActionType.focus]: (data, duration) => {
			const spl = data?.split('|').map(s => s.trim());
			const name = spl?.[0]??'';
			const imgs = name.split(',')
				.map(i => this.imageMap.get(i.trim()))
				.filter((i): i is MicrioImage => i !== undefined);
			if(imgs.length == 1) this.focus(imgs[0], {duration});
			else if(imgs.length > 0) this.set(imgs.map(i => this.getString(i.$info!)).join(';'), {
				duration,
				horizontal: spl?.[1] == 'h'
			});
		},

		[Enums.Grid.GridActionType.flyTo]: (data, duration) => {
			const images = data?.split(',').map(s => this.current.find(i => i.id == s?.trim()));
			if(images?.length) this.image.camera.flyToView([
				Math.min(...images.map(i => i?.opts.area?.[0] ?? 0)),
				Math.min(...images.map(i => i?.opts.area?.[1] ?? 0)),
				Math.max(...images.map(i => i?.opts.area?.[2] ?? 1)),
				Math.max(...images.map(i => i?.opts.area?.[3] ?? 1)),
			], {duration:duration?duration*1000:undefined}).catch(()=>{});
			else console.warn('Given image IDs gave no current displayed images');
		},

		[Enums.Grid.GridActionType.focusTagged]: (data, duration) => {
			this.flyToMarkers(data, duration);
		},

		[Enums.Grid.GridActionType.focusWithTagged]: (data, duration) => {
			this.flyToMarkers(data, duration, true);
		},

		[Enums.Grid.GridActionType.reset]: (_data, duration) => {
			this.reset(duration);
		},

		[Enums.Grid.GridActionType.back]: (_data, duration) => {
			this.back(duration);
		},

		[Enums.Grid.GridActionType.switchToGrid]: () => {
			this.switchToGrid();
		},

		[Enums.Grid.GridActionType.nextFadeDuration]: (data) => {
			this.nextCrossFadeDuration = Number(data);
		},

		[Enums.Grid.GridActionType.filterTourImages]: (data, duration) => {
			once(this.micrio.state.tour).then(t => { if(!t) return;
				if(!('steps' in t) || !t.stepInfo) return;
				const ids = t.stepInfo.map(s => s.micrioId);
				const str = ids.filter((id, i) => ids.indexOf(id) == i)
					.map(i => this.imageMap.get(i))
					.filter((i): i is MicrioImage => !!i)
					.map(i => this.getString(i.$info!)).join(';')
				if(str) this.set(str, {
					duration,
					horizontal: data == 'h'
				});
			});
		},
	};

	/** Do an (external) action
	 * @param action The action type enum or string
	 * @param data Optional action data
	 * @param duration Optional action duration
	*/
	action(action:Enums.Grid.GridActionType|string, data?:string, duration?:number) : void {
		if(typeof action == 'string') action = Enums.Grid.GridActionType[action as keyof typeof Enums.Grid.GridActionType];
		const key = action+(data??'');
		if(this.lastAction == key) return;
		const handler = this.actionHandlers[action as number];
		if(handler) handler(data, duration);
		else console.warn('Warning: unknown grid tour event', action);
		this.lastAction = key;
	}

	/** Enlarge a specific image idx of the currently shown grid
	 * @param idx The image index of the current grid
	 * @param width The image target number of columns
	 * @param height The image target number of rows
	 * @returns Promise when the transition is completed
	*/
	async enlarge(idx:number, width:number, height:number=width) : Promise<MicrioImage[]> {
		return this.set((this.history[this.history.length-1]?.layout || this.image.$info!.grid!)
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
	}
}
