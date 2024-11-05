/**
 * Micrio grid display controller
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';

import { MicrioImage } from './image';
import { get, writable, type Unsubscriber, type Writable } from 'svelte/store';
import { deepCopy, once, sleep } from './utils';
import { tick } from 'svelte';
import { Enums } from '../ts/enums';

const round = (n:number) => Math.round(n*100000)/100000;

/** The Grid controller class */
export class Grid {
	/** Convert an ImageInfo object to an individual image grid string
	 * @internal
	*/
	static getString = (i:Models.ImageInfo.ImageInfo, opts: {
		view?:Models.Camera.View;
		area?:Models.Camera.View;
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

	/** The instanced grid images */
	readonly images:MicrioImage[] = [];

	/** The currently shown images */
	current:MicrioImage[] = [];

	/** The grid HTML element */
	_grid = document.createElement('div');

	/** The image HTML `<button>` grid elements */
	_buttons:Map<string, HTMLButtonElement> = new Map();

	/** The HTML grid will stay visible and clickable */
	clickable:boolean = false;

	/** The current full-view focussed image */
	readonly focussed:Writable<MicrioImage|undefined> = writable();

	/** Get the current focussed store value */
	get $focussed() : MicrioImage|undefined { return get(this.focussed); }

	/** Show the markers of these elements */
	readonly markersShown:Writable<MicrioImage[]> = writable([]);

	/** The grid state history */
	history:Models.Grid.GridHistory[] = [];

	/** The current history length */
	public depth:Writable<number> = writable<number>(0);

	/** The animation duration when opening a new layout, in s */
	aniDurationIn:number = 1.5;

	/** The animation duration when going back, in s */
	aniDurationOut:number = 0.5;

	/** For delayed transitions, individual delay in s */
	transitionDelay:number = .5;

	/** Duration for the next crossfade */
	private nextCrossFadeDuration:number|undefined;

	/** The current grid layout is a single horizontal row */
	private isHorizontal:boolean = false;

	/** Current individual cell sizes w,h */
	readonly cellSizes:Map<string, [number,number?]> = new Map();

	/** Temporary size map for next .set() */
	private readonly nextSize:Map<string, [number,number?]> = new Map();

	/** Currently running custom action
	 * @internal
	*/
	private lastAction:string|undefined;

	/** View watch unsubscriber
	 * @internal
	*/
	private viewUnsub:Unsubscriber|undefined;

	/** Setting timeout
	 * @internal
	*/
	private _to:any

	/** Setting timeout for fade
	 * @internal
	*/
	private _fadeTo:any

	/** Animation timing function
	 * @internal
	*/
	private timingFunction:Models.Camera.TimingFunction = 'ease';

	/** The last .set() promise
	 * @internal
	*/
	lastPromise:Promise<MicrioImage[]>|undefined;

	/** The Grid constructor
	 * @param micrio The Micrio instance
	 * @param image The MicrioImage which is the virtual grid container
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

		// Fire loaded event when all relevant image data is downloaded
		const loaded = () => tick().then(() => {
			this.hook();
			micrio.events.dispatch('grid-load');
		});

		// Propagate this image's language to children
		if(!image.isV5) micrio._lang.subscribe(l => {
			// Wait for all individual image data to load
			if(l) Promise.all(this.images.filter(i => (i.$info && 'cultures' in i.$info && i.$info?.cultures as string || '').indexOf(l) >= 0).map(i => once(i.data))).then(loaded);
			else loaded();
		});

		micrio.events.dispatch('grid-init', this);
	}

	/** Hook all events */
	private hook() {
		// Support marker custom grid actions
		this.micrio.state.marker.subscribe(m => {
			if(m && typeof m != 'string') {
				const d = m.data?._meta;
				if(d?.gridSize) {
					const s = (typeof d.gridSize == 'number' ? [d.gridSize, d.gridSize]
						: d.gridSize.split(',').map(Number)) as [number, number];
					const micId = this.images.find(i => i.$data?.markers?.find(n => n == m))?.id;
					if(micId) this.nextSize.set(micId, s);
				}
				// Allow time for marker to temporarily remove gridAction
				// in case it starts a tour from the beginning
				tick().then(() => {
					const a = d?.gridAction?.split('|');
					if(a?.length && typeof a[0] == 'string') this.action(a.shift() as string, a.join('|'));
				})
			}
		});

		if(this.clickable) {
			this._grid.addEventListener('click', e => {
				const id = (e.target as HTMLElement).dataset.id;
				if(id) this.focus(this.images.find(i => i.id == id));
			});

			const placeOrRemove = (t:any) => { if(t) this.removeGrid(); else this.placeGrid(); };

			this.micrio.state.tour.subscribe(placeOrRemove);
			this.micrio.state.marker.subscribe(placeOrRemove);
			this.focussed.subscribe(placeOrRemove);
		}

		// Tour logic
		this.micrio.addEventListener('tour-event', this.tourEvent);
		this.micrio.addEventListener('serialtour-pause', () => this.images.forEach(i => i.camera.pause()));
		this.micrio.addEventListener('serialtour-play', () => this.images.forEach(i => i.camera.resume()));
	}

	private clearTimeouts() : void {
		clearTimeout(this._to);
		clearTimeout(this._fadeTo);
	}

	/** Set the grid to this input
	 * @param input The grid string
	 * @param opts Optional settings
	 * @returns Promise when the animation is done with the currently shown images
	*/
	set(input:string|MicrioImage[]|({image:MicrioImage} & Models.Grid.GridImageOptions)[]='', opts:{
		/** Don't add the layout to the history stack */
		noHistory?:boolean;
		/** Don't remove the grid HTML element */
		keepGrid?: boolean;
		/** The layout is horizontal */
		horizontal?:boolean;
		/** Any main camera animation duration in seconds */
		duration?:number;
		/** Fly the main grid view to this viewport */
		view?:Models.Camera.View;
		/** Don't draw any frame or do any camera stuff */
		noCamAni?: boolean;
		/** Force area animating for images currently not visible */
		forceAreaAni?: boolean;
		/** Don't unfocus the current focussed image */
		noBlur?: boolean;
		/** Don't do any fading in */
		noFade?: boolean;
		/** Transition animation, defaults to crossfade */
		transition?: Models.Grid.GridSetTransition;
		/** Force an animation for all images */
		forceAni?: boolean;
		/** Limit the images to cover view */
		coverLimit?: boolean;
		/** Open the images on cover view, but don't limit */
		cover?: boolean;
		/** Scale individual grid images (0-100%) */
		scale?: number;
		/** Grid columns */
		columns?: number;
	}={}) : Promise<MicrioImage[]> { return this.lastPromise = new Promise((ok, err) => {
		delete this.image.$info?.settings?.focus;
		this.lastAction = undefined;

		if(opts.cover === false && opts.coverLimit) opts.coverLimit = false;
		if(opts.coverLimit && opts.cover == undefined) opts.cover = opts.coverLimit;

		// MicrioImage[] are also allowed as input
		if(typeof input != 'string')
			input = input.map(i => i instanceof MicrioImage	? {image:i} : i)
			.filter(g => !!g.image.$info).map(g => this.getString(g.image.$info!, g)).join(';');

		const images:Models.Grid.GridImage[] = input.split(';').filter(s => !!s).map(s => this.getImage(s));
		const focussed = this.$focussed;
		const isDelayed = opts.transition?.endsWith('-delayed');
		const isBehindDelay = opts.transition == 'behind-delayed';

		switch(opts.transition) {
			case 'crossfade':
				opts.duration = 0;
			break;
			case 'behind':
			case 'behind-delayed':
				const isLim = opts.coverLimit === true;
				opts.forceAni = true;
				opts.coverLimit = isLim;
				opts.forceAreaAni = true;
				const vW = isDelayed ? 1/images.length : 1;
				let c:number = 0;
				this.images.forEach(i => {
					i.camera.setCoverLimit(isLim);
					if(images.find(e => e.id == i.id)) {
						i.camera.setArea([0,0,focussed?.id == i.id ? 1 : vW,1], {noDispatch: true, direct: true});
						if(i != focussed) i.camera.setView([0,0,1,1]);
						if(isDelayed) this.micrio.wasm.e._setZIndex(i.ptr, images.length-(c++));
					}
				});
				images.forEach(e => e.view = [0,0,1,1]);
			break;
		}

		const ready = this.image.ptr >= 0;
		const dur = opts.duration ?? (opts.noHistory ? this.aniDurationOut : this.aniDurationIn);
		const defaultDur = this.nextCrossFadeDuration ?? this.image.$settings.crossfadeDuration ?? 1;
		const crossfadeDur = (dur || this.aniDurationIn) / (isBehindDelay ? 2 : 1);
		this.nextCrossFadeDuration = undefined;
		if(ready) {
			const ptr = this.micrio.wasm.getPtr();
			this.micrio.wasm.e.setGridTransitionDuration(ptr, dur);
			this.micrio.wasm.e.setCrossfadeDuration(ptr, crossfadeDur);
		}

		const doUnfocus = !opts.noBlur && focussed;
		if(doUnfocus) this.blur();

		if(!opts.noHistory && this.current.length) this.depth.set(this.history.push({
			layout: this.current.map(i => this.getString(i.$info as Models.ImageInfo.ImageInfo, {
				view: i.state.$view,
				size: this.cellSizes.get(i.id) as [number,number]
			})).join(';'),
			horizontal: this.isHorizontal,
			view: this.image.camera.getView()
		}));

		this.isHorizontal = !!opts.horizontal;

		// Fade out existing that are not in the new layout
		this.removeImages(this.images.filter(i => !images.find(n => n.id == i.id)));

		// Generate the grid
		this.printGrid(images, {
			horizontal: opts.horizontal,
			keepGrid: opts.keepGrid,
			scale: opts.scale,
			columns: opts.columns
		});

		// Reset timeouts of any running operation
		this.clearTimeouts();

		let _to:any;
		let _fto:any;
		let resolved:boolean = false;

		// If camera transition is interrupted
		const error = () => {
			clearTimeout(_to);
			clearTimeout(_fto);
			if(!resolved) err();
		};

		if(ready && !opts.noCamAni) {
			if(opts.view) this.image.camera.flyToView(opts.view, {duration:dur*1000}).catch(error);
			else this.image.camera.flyToFullView({duration:dur*1000}).catch(error);
		}

		// Reset the nextSize map
		this.nextSize.clear();

		if(opts.coverLimit == undefined) opts.coverLimit = true;
		if(!opts.coverLimit) images.forEach(i => this.images.find(img => img.id == i.id)?.camera.setCoverLimit(!!opts.coverLimit));

		const isAppear = opts.transition == 'appear-delayed';
		const getDelay = (i:number) : number => i * this.transitionDelay + (i > 0 && isAppear ? dur : 0);

		// Place them, don't animate if unfocussing and not focussed image
		this.current = images.map((img,i) => this.placeImage(img, {
			duration: !opts.forceAni && doUnfocus && img.id != focussed.id ? 0 : dur,
			delay: isDelayed ? getDelay(i) : 0,
			noCamAni: isAppear && i > 0 ? true : !!opts.noCamAni,
			forceAreaAni: isAppear && i > 0 ? false : opts.forceAreaAni,
			cover: opts.cover
		}));

		if(isAppear) this.current.slice(1).forEach(i => this.micrio.wasm.e._fadeTo(i.ptr, .9999, true));

		const fadeIn = () => this.current.forEach((img,i) =>
			sleep(isDelayed ? (getDelay(i) + (isBehindDelay ? dur/2 : 0)) * 1000 : 0)
				.then(() => this.micrio.wasm.e._fadeIn(img.ptr))
		);

		const done = () => {
			this.clearTimeouts();
			// Reset default fade duration
			requestAnimationFrame(() => this.micrio.wasm.e.setCrossfadeDuration(this.micrio.wasm.getPtr(), defaultDur));
			if(isDelayed) this.images.forEach(i => this.micrio.wasm.e._setZIndex(i.ptr, 0));
			if(opts.coverLimit) images.forEach(i => this.images.find(img => img.id == i.id)?.camera.setCoverLimit(!!opts.coverLimit));
			if(this.clickable) this.placeGrid();
			this.lastAction = undefined;
			resolved = true;
			ok(this.current);
		}

		// Fade in any previously faded out after the duration
		if(!dur && !crossfadeDur) {
			if(!opts.noFade) fadeIn();
			done();
		}
		else {
			if(!opts.noFade) this._fadeTo = _fto = <unknown>setTimeout(fadeIn, Math.max(0, dur / 2)) as number;
			this._to = _to = setTimeout(done, (Math.max(crossfadeDur, dur) + (isDelayed ? (images.length-1) * this.transitionDelay : 0))*1000 );
		}
	})}

	/** See if grid has changed configuration from original state */
	private hasChanged() : boolean {
		return this.current.map(i => i.id).join(',') != this.images.map(i => i.id).join(',');
	}

	/** Convert a grid string to GridImage object
	 * @param s The image individual encoded grid string
	 * @returns the GridImage
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
			view: p[5] ? p[5].split('/').map(Number) : undefined,
			area: p[6] ? p[6].split('/').map(Number) : undefined,
			settings: deepCopy(this.image.$settings||{}, {
				focus: p[7] ? p[7].split('-').map(Number) : null
			}),
			/** @ts-ignore */
			cultures: p[8]?.replace(/\-/g,',')||undefined
		}
	}

	/** Convert an ImageInfo object to an individual image grid string
	 * @returns The grid encoded string of this image
	*/
	getString = (i:Models.ImageInfo.ImageInfo, opts:Models.Grid.GridImageOptions = {}) : string => Grid.getString(i, {
		view: opts.view,
		area: opts.area,
		size: opts.size ?? this.nextSize.get(i.id) as [number,number],
		cultures: ('cultures' in i && i['cultures'] ? i.cultures as string : '')?.replace(/,/g,'-')
	});

	private getCols(images:number, numTiles:number) : number {
		let num = Math.ceil(numTiles / Math.ceil(Math.sqrt(numTiles)));
		if(images == numTiles) {
			const margin = Math.floor(Math.sqrt(images)), cols:number[] = [];
			for(let n = margin; n < num+margin; n++) if(!(images % n)) cols.push(n);
			if(cols.length) num = cols[Math.floor(cols.length / 2)];
		}
		return num;
	}

	/** Print the image grid based on a generated HTML layout
	 * @param images Print these images
	 * @param horizontal Print the images as a single row
	*/
	private printGrid(images:Models.Grid.GridImage[], opts:{
		horizontal?:boolean;
		keepGrid?:boolean;
		scale?:number;
		columns?:number;
	}) : void {
		if(!opts.keepGrid) this.removeGrid();
		/** @ts-ignore */
		const numTiles = images.reduce((n,i) => n+i.size.reduce((v,n) => n*v, 1), 0);
		const cols = opts.columns ?? (opts.horizontal ? images.length : this.getCols(images.length, numTiles));
		this._grid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
		this._grid.textContent = '';
		this._grid.style.removeProperty('--translate');
		this._grid.style.removeProperty('--scale');

		images.forEach(i => { if(!i.id) return;
			if(!this._buttons.has(i.id)) this._buttons.set(i.id, document.createElement('button'));
			const tile = this._buttons.get(i.id) as HTMLButtonElement;
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

		// Allow for custom CSS grid override
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

	/** Place and watch the grid */
	private placeGrid() : void {
		if(!this.clickable || this.micrio.state.$tour || this.micrio.state.$marker) return;
		if(this._grid.parentNode) return;
		this.micrio.insertBefore(this._grid, this.micrio.firstChild?.nextSibling ?? null);
		this.viewUnsub = this.image.state.view.subscribe(this.updateGrid);
	}

	/** Remove the grid */
	private removeGrid() : void {
		if(!this._grid.parentNode) return;
		if(this.viewUnsub) this.viewUnsub();
		this._grid.remove();
	}

	/** Update grid placement */
	private updateGrid() : void {
		const xy = this.image.camera.getXY(0,0, true);
		this._grid.style.setProperty('--translate', `translate3d(${xy[0]}px, ${xy[1]}px, 0)`);
		this._grid.style.setProperty('--scale', this.image.camera.getScale().toString());
		this._grid.dispatchEvent(new CustomEvent('update'));
	}

	/** Place an image in the grid
	 * @param entry The GridImage:MicrioInfo info object
	 * @param duration The duration of flying to an optional view
	 * @param noCamAni Just set internal values, don't animate camera
	 * @param delay Delay the animation, s
	 * @returns The instanced MicrioImage
	*/
	private placeImage(entry:Models.Grid.GridImage, opts: {
		duration:number;
		delay:number;
		noCamAni?:boolean;
		forceAreaAni?:boolean;
		cover?:boolean;
	}) : MicrioImage {
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
		this.micrio.wasm.e._setZIndex(focussed.ptr, 2);
		this.micrio.events.dispatch('grid-blur');
		this.focussed.set(undefined);
		this.image.camera.setLimit([0, 0, 1, 1]);
		this.micrio.current.set(this.image);
	}

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
	getRelativeView(image:MicrioImage, view:Models.Camera.View) : Models.Camera.View {
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
