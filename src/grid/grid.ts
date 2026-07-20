import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$core/element';

import { MicrioImage } from '$core/image';
import { get, writable, type Unsubscriber, type Writable, tick } from '$core/store';
import { GridActionType } from './actions';
import { getEasing } from '$render/easing';
import { createElement, sleep } from '$utils/dom';
import { pointInArea } from '$utils/math';

import { getCols } from './format';
import { hookGridKeys } from './keyboard';
import { setupBehindTransition, transition } from './transitions';
import { handleAction, createTourEventHandler } from './action-handlers';

export class Grid {
	readonly images:MicrioImage[] = [];
	readonly imageMap:Map<string, MicrioImage> = new Map();

	current:MicrioImage[] = [];

	_grid = createElement('div', { className: 'micrio-grid' });
	_buttons:Map<string, HTMLButtonElement> = new Map();

	clickable: 'focus'|'zoom'|false = false;
	panZoom: 'cells'|'grid' = 'grid';

	readonly focussed:Writable<MicrioImage|undefined> = writable();
	get $focussed() : MicrioImage|undefined { return get(this.focussed); }
	readonly markersShown:Writable<MicrioImage[]> = writable([]);

	history:Models.Grid.GridHistory[] = [];
	public depth:Writable<number> = writable<number>(0);

	aniDurationIn:number = 1;
	aniDurationOut:number = 0.5;
	transitionDelay:number = .5;

	nextCrossFadeDuration:number|undefined;
	isHorizontal:boolean = false;
	readonly cellSizes:Map<string, [number,number?]> = new Map();
	readonly nextSize:Map<string, [number,number?]> = new Map();

	lastAction:string|undefined;
	viewUnsub:Unsubscriber|undefined;
	_to:ReturnType<typeof setTimeout>|undefined;
	_fadeTo:ReturnType<typeof setTimeout>|undefined;
	#timingFunction:Models.Camera.TimingFunction = 'ease';

	static handlingKeys:boolean = false;

	lastPromise:Promise<MicrioImage[]>|undefined;

	#initialGrid: Models.ImageInfo.ImageInfo[] = [];

	constructor(
		public micrio:HTMLMicrioElement,
		public image:MicrioImage,
		gridImages?: Models.ImageInfo.ImageInfo[]
	) {
		this.#initialGrid = gridImages ?? [];

		const g = image.$settings?.grid;
		this.clickable = g?.clickable == 'focus' || g?.clickable == 'zoom' ? g.clickable : false;
		this.panZoom = g?.panZoom == 'cells' ? 'cells' : 'grid';
		if(this.clickable && image.$settings.hookKeys) hookGridKeys(this);
		if(g?.transitionDuration !== undefined) this.aniDurationIn = this.aniDurationOut = g.transitionDuration;
		if(g?.transitionDurationOut !== undefined) this.aniDurationOut = g.transitionDurationOut;

		tick().then(() => this.set(this.#initialGridImages, {
			cover: this.image.$settings?.initType == 'cover',
			duration: 0,
		}).then(() => {
			this.#hook();
			micrio.events.dispatch('grid-load');
		}));

		micrio.events.dispatch('grid-init', this);
	}

	#hook() {
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
				this.clickCell((e.target as HTMLElement)?.dataset.id);
			});

			const placeOrRemove = (t:unknown) => { if(t) this.#removeGrid(); else this.#placeGrid(); };
			this.micrio.state.tour.subscribe(placeOrRemove);
			this.micrio.state.marker.subscribe(placeOrRemove);
			this.focussed.subscribe(placeOrRemove);
		}

		this._tourEventHandler = createTourEventHandler(this);
		this.micrio.addEventListener('tour-event', this._tourEventHandler);
		this.micrio.addEventListener('serialtour-pause', () => this.images.forEach(i => i.camera.pause()));
		this.micrio.addEventListener('serialtour-play', () => this.images.forEach(i => i.camera.resume()));
	}

	_tourEventHandler: ((e: Event) => void) | undefined;

	#clearTimeouts() : void {
		clearTimeout(this._to);
		clearTimeout(this._fadeTo);
	}

	#trackImage(img: MicrioImage): void {
		this.images.push(img);
		this.imageMap.set(img.id, img);
	}

	get #initialGridImages(): Models.Grid.GridImage[] {
		return this.#initialGrid.map(i => ({ id: i.id, size: [1] as [number, number?] }));
	}

	#getAttrForEntry(entry: Models.Grid.GridImage): Models.ImageBundle.BundleImage {
		const orig = this.#initialGrid.find(i => i.id === entry.id);
		return {
			id: entry.id,
			info: {
				id: entry.id,
				path: this.image.$info?.path ?? '',
				version: '',
				width: orig?.width ?? 0,
				height: orig?.height ?? 0,

			} as Models.ImageInfo.ImageInfo,
		};
	}

	#savePreviousLayout(): void {
		this.depth.set(this.history.push({
			layout: this.current.map(i => ({
				id: i.id,
				view: i.state.$view,
				size: this.cellSizes.get(i.id) as [number, number?] | undefined,
			})),
			horizontal: this.isHorizontal,
			view: this.image.camera.getView()
		}));
	}

	set(images:Models.Grid.GridImage[]=[], opts:{
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
		delete this.image.$settings?.focus;
		this.lastAction = undefined;

		if(opts.cover === false && opts.coverLimit) opts.coverLimit = false;
		if(opts.coverLimit && opts.cover == undefined) opts.cover = opts.coverLimit;
		const focussed = this.$focussed;
		const isDelayed = opts.transition?.endsWith('-delayed');
		const isBehindDelay = opts.transition == 'behind-delayed';
		const { engine } = this.micrio;

		if(opts.transition == 'crossfade') opts.duration = 0;
		else if(opts.transition == 'behind' || opts.transition == 'behind-delayed')
			setupBehindTransition(this, images, opts, focussed);

		const ready = this.image.placed;
		const dur = opts.duration ?? (opts.noHistory ? this.aniDurationOut : this.aniDurationIn);
		const defaultDur = this.nextCrossFadeDuration ?? this.image.$settings.crossfadeDuration ?? 1;
		const crossfadeDur = (dur || this.aniDurationIn) / (isBehindDelay ? 2 : 1);
		this.nextCrossFadeDuration = undefined;
		if(ready) {
			engine.gridTransitionDuration = dur;
			engine.crossfadeDuration = crossfadeDur;
		}

		const doUnfocus = !opts.noBlur && focussed;
		if(doUnfocus) this.blur();

		if(!opts.noHistory && this.current.length) this.#savePreviousLayout();
		this.isHorizontal = !!opts.horizontal;

		this.#removeImages(this.images.filter(i => !images.find(n => n.id == i.id)));
		this.#printGrid(images, {
			horizontal: opts.horizontal,
			keepGrid: opts.keepGrid,
			scale: opts.scale,
			columns: opts.columns
		});

		this.#clearTimeouts();

		let resolved = false;
		const error = () => {
			this.#clearTimeouts();
			if(!resolved) err();
		};

		if(ready && !opts.noCamAni) {
			const p = opts.view ? this.image.camera.flyToView(opts.view, {duration:dur*1000})
				: this.image.camera.flyToFullView({duration:dur*1000});
			p.catch(error);
		}

		this.nextSize.clear();

		if(opts.coverLimit == undefined) opts.coverLimit = !!this.image.$settings.limitToCoverScale;
		images.forEach(i => this.imageMap.get(i.id)?.camera.setCoverLimit(!!opts.coverLimit));

		const isAppear = opts.transition == 'appear-delayed';
		const getDelay = (i:number) : number => i * this.transitionDelay + (i > 0 && isAppear ? dur : 0);

		this.current = images.map((img,i) => this.#placeImage(img, {
			duration: !opts.forceAni && doUnfocus && img.id != focussed?.id ? 0 : dur,
			delay: isDelayed ? getDelay(i) : 0,
			noCamAni: isAppear && i > 0 ? true : !!opts.noCamAni,
			forceAreaAni: isAppear && i > 0 ? false : opts.forceAreaAni,
			cover: opts.cover
		}));

		if(isAppear) this.current.slice(1).forEach(i => { const c = i.canvas; c && (c.targetOpacity = c.opacity = .9999); });

		const fadeIn = () => this.current.forEach((img,i) =>
			sleep(isDelayed ? (getDelay(i) + (isBehindDelay ? dur/2 : 0)) * 1000 : 0)
				.then(() => img.canvas?.fadeIn())
		);

		const done = () => {
			this.#clearTimeouts();
			requestAnimationFrame(() => engine.crossfadeDuration = defaultDur);
			if(isDelayed) this.images.forEach(i => { if (i.canvas) i.canvas.zIndex = 0; });
			if(opts.coverLimit) images.forEach(i => this.imageMap.get(i.id)?.camera.setCoverLimit(true));
			if(this.clickable) this.#placeGrid();
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

	#hasChanged() : boolean {
		if(this.current.length !== this.images.length) return true;
		return this.current.some((img, i) => img.id !== this.images[i].id);
	}

	#printGrid(images:Models.Grid.GridImage[], opts:{
		horizontal?:boolean;
		keepGrid?:boolean;
		scale?:number;
		columns?:number;
	}) : void {
		if(!opts.keepGrid) this.#removeGrid();
		const numTiles = images.reduce((n, i) => n + i.size[0] * (i.size[1] ?? 1), 0);
		const cols = opts.columns ?? (opts.horizontal ? images.length : getCols(images.length, numTiles));
		this._grid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
		this._grid.textContent = '';
		this._grid.style.removeProperty('--translate');
		this._grid.style.removeProperty('--scale');

		images.forEach(i => {
			if(!this._buttons.has(i.id)) this._buttons.set(i.id, createElement('button'));
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
			tile.setAttribute('data-scroll-through', '');
			this._grid.appendChild(tile);
		});

		this._grid.classList.toggle('grid-pan-zoom', this.panZoom == 'grid');

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
			if(img && !img.area) img.area = [(r.x+o[0])/w, (r.y+o[1])/h, (r.width-o[0]*2)/w, (r.height-o[1]*2)/h]
		});

		if(!opts.keepGrid) this._grid.remove();
	}

	#placeGrid() : void {
		if(!this.clickable || this.micrio.state.$tour || this.micrio.state.$marker) return;
		if(this._grid.parentNode) return;
		this.micrio.insertBefore(this._grid, this.micrio.firstChild?.nextSibling ?? null);
		this.viewUnsub = this.image.state.view.subscribe(this.#updateGrid);
	}

	#removeGrid() : void {
		if(!this._grid.parentNode) return;
		if(this.viewUnsub) this.viewUnsub();
		this._grid.remove();
	}

	#updateGrid = () : void => {
		const xy = this.image.camera.getXY(0,0, true);
		this._grid.style.setProperty('--translate', `translate3d(${xy[0]}px, ${xy[1]}px, 0)`);
		this._grid.style.setProperty('--scale', this.image.camera.getScale().toString());
		this._grid.dispatchEvent(new CustomEvent('update'));
	}

	#placeImage(entry:Models.Grid.GridImage, opts: {
		duration:number;
		delay:number;
		noCamAni?:boolean;
		forceAreaAni?:boolean;
		cover?:boolean;
	}) : MicrioImage {
		const { engine } = this.micrio;
		let img = this.imageMap.get(entry.id);
		if(img && entry.area) sleep(opts.delay*1000).then(() => {
			img!.camera.setArea(entry.area!, {
				direct: opts.duration==0 || (!opts.forceAreaAni && !get(img!.visible))
			});
			if(opts.delay) engine.render();
		});
		else {
			const bundle = this.#getAttrForEntry(entry);
			img = new MicrioImage(engine, bundle, {area: entry.area});
			img.info.subscribe(() => {})();
			engine.addChild(img, this.image);
			this.#trackImage(img);
		}

		const aniOpts = {duration:opts.duration*1000, timingFunction: this.#timingFunction, limit: false};
		if(!opts.noCamAni && !img.camera.aniDone && img.placed) {
			const p = entry.view ? img.camera.flyToView(entry.view, aniOpts)
				: opts.cover ? img.camera.flyToCoverView(aniOpts)
				: img.camera.flyToView([0,0,1,1], aniOpts);
			p.catch(() => {});
		}

		return img;
	}

	#removeImages(images:MicrioImage[]) : void {
		const { engine } = this.micrio;
		images.forEach(i => {
			if(i.placed) i.canvas?.fadeOut();
			this._buttons.delete(i.id);
		});
		engine.render();
	}

	insideGrid() : boolean {
		const c = this.micrio.$current;
		return c == this.image || (!!c && this.imageMap.has(c.id));
	}

	async reset(duration?:number, noCamAni?:boolean, forceAni?:boolean) : Promise<MicrioImage[]> {
		const state = this.history[0];
		this.images.forEach(i => i.camera.stop());
		this.image.camera.stop();
		this.markersShown.set([]);
		await tick();
		if(!forceAni && !noCamAni && this.micrio.camera?.isZoomedOut() && !this.micrio.state.$tour && !this.$focussed && !this.#hasChanged()) duration = 0;
		return this.set(this.#layoutFromHistoryEntry(state) ?? this.#initialGridImages, { noHistory: true, duration, noCamAni, forceAni, horizontal: state ? state.horizontal : false }).then(i => {
			this.depth.set(this.history.length = 0);
			this.micrio.current.set(this.image);
			return i;
		});
	}

	async flyToMarkers(tag?:string, duration?:number, noZoom?:boolean) : Promise<MicrioImage[]> {
		const spl = tag?.split('|').map(s => s.trim());
		const name = spl?.[0]??'';
		const images = !name ? this.images : this.images.filter(i => !!i.$data?.markers?.find(m => m.tags?.includes(name)));
		return this.set(images.map(img => {
			const m = img.$data?.markers?.find(m => m.tags?.includes(name));
			return { id: img.id, size: [1], view: !noZoom ? m?.view : undefined };
		}),{duration, horizontal: spl?.[1]=='h'});
	}

	async back(duration?:number) : Promise<void> {
		const state = this.history.pop();
		if(!state) return;

		this.depth.set(this.history.length);
		this.micrio.current.set(this.image);

		const focussed = this.$focussed;
		if(focussed) this.blur();

		const input = this.#layoutFromHistoryEntry(state) ?? [];
		await this.set(input, {
			duration,
			noHistory: true,
			horizontal: state.horizontal,
			view: state.view
		});
	}

	#layoutFromHistoryEntry(state: Models.Grid.GridHistory | undefined): Models.Grid.GridImage[] | undefined {
		if (!state?.layout?.length) return;
		return state.layout.map(entry => {
			if (!this.imageMap.has(entry.id)) return null;
			return { id: entry.id, size: entry.size ?? [1], view: entry.view };
		}).filter(Boolean) as Models.Grid.GridImage[];
	}

	#setTimingFunction(fn:Models.Camera.TimingFunction) : void {
		this.micrio.engine.gridTransitionTimingFunction = getEasing(this.#timingFunction=fn);
	}

	clickCell(_img?:MicrioImage|string) : void {
		const img = typeof _img == 'string' ? this.images.find(i => i.id == _img) : _img;
		if(!this.clickable || !img) return;
		this._buttons.forEach(b => b.classList.remove('focussed'));
		this._buttons.get(img.id)?.classList.add('focussed');
		if(this.clickable == 'zoom') {
			const a = img.opts.area ?? [0,0,1,1];
			this.image.camera.flyToView(a, {duration: this.aniDurationIn * 1000, limit: false});
		} else this.focus(img);
	}

	async focus(img:MicrioImage|undefined, opts: Models.Grid.FocusOptions={}) : Promise<void> {
		if(!img) return this.back();

		if(opts.coverLimit) opts.cover = true;

		const m = this.micrio;

		if(!get(m.visible).find(i => i == this.image)) m.current.set(this.image);

		const focussed = this.$focussed;

		if(focussed == img) return;

		const direct = !opts.transition?.startsWith('slide-') && (opts.duration == 0 || (focussed && !(focussed.canvas?.areaAnimating() ?? false) && !this.current.includes(img)));
		if(direct) img.camera.setArea([0,0,1,1], {noDispatch: true, direct: true});
		if(focussed) this.blur();

		img.camera.setCoverLimit(!!opts.cover);
		this.#setTimingFunction('ease');

		const target = await transition(this, img, focussed, opts);

		if (img.canvas) img.canvas.zIndex = 3;
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
			this.#removeGrid();
			if(m.$current != img) m.current.set(img);
			this.image.camera.setLimit([0, 0, 1, 1]);
		}).catch(() => {});
	}

	blur() : void {
		const focussed = this.$focussed;
		if(!focussed) return;
		this._buttons.forEach(b => b.classList.remove('focussed'));
		if (focussed.canvas) focussed.canvas.zIndex = 2;
		this.micrio.events.dispatch('grid-blur');
		this.focussed.set(undefined);
		this.image.camera.setLimit([0, 0, 1, 1]);
		this.micrio.current.set(this.image);
	}

	action(action:GridActionType|string, data?:string, duration?:number) : void {
		handleAction(this, action, data, duration);
	}

	async enlarge(idx:number, width:number, height:number=width) : Promise<MicrioImage[]> {
		const layout = this.history[this.history.length-1]?.layout ?? this.#initialGrid;
		if (!layout?.length) return this.current;
		const entries = layout as { id: string; size?: [number, number?] }[];
		const input: Models.Grid.GridImage[] = entries.map((e, i) => ({
			id: e.id,
			size: i == idx ? [width, height] as [number, number] : e.size ?? [1],
		}));
		return this.set(input, { noHistory: true, keepGrid: true, duration: 500 });
	}

	getImageAt(clientX: number, clientY: number): MicrioImage | undefined {
		const current = this.micrio.$current;
		if (current && this.images.some(i => i === current)) return current;
		if (this.panZoom == 'grid') return this.image;
		const coo = this.image.camera.getCoo(clientX, clientY, true);
		const vx = coo[0], vy = coo[1];
		return this.current.find(i => i.opts.area && pointInArea(vx, vy, i.opts.area as [number, number, number, number]));
	}

	getRelativeView(image:MicrioImage, view:Models.Camera.View) : Models.Camera.View {
		const a = image.opts.area ?? [0,0,1,1];
		return [
			a[0] + a[2] * view[0],
			a[1] + a[3] * view[1],
			a[2] * view[2],
			a[3] * view[3]
		]
	}
}
