import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';
import type { Omni } from '$types/models/omni';
import type { MicrioElement } from '$core/component';
import { easeInOut } from '$render/easing';
import { DataLoader } from '$utils/dataLoader';
import { archive } from '$utils/archive';
import { createElement } from '$utils/dom';
import { icons } from '$ui/icons';
import { get, writable } from '$core/store';
import '$ui/dial';

export class OmniUI {
	#micrio:HTMLMicrioElement;
	#image:MicrioImage;
	#parent:HTMLElement;

	#swiperLength:number = 0;
	#swiperOpts:{sensitivity?:number; continuous?:boolean; coverLimit?:boolean} = {};

	#startIndex:number|undefined;
	#startX:number|undefined;
	#hitTresh:boolean = false;
	#snapTo:number[] = [];
	#raf:number|undefined;
	#pointers:Map<number, boolean> = new Map();
	#isFullWidth:boolean = false;
	#startedWithShift:boolean = false;
	#firstTouchId:number|undefined;
	#goto:(i:number) => void = () => {};
	#preloadRangeFn:(center:number,total:number,d:number,getTile:(idx:number)=>{baseTileIdx:number;thumbSrc?:string}|undefined,engine:any,hasArchive:boolean)=>void;
	#cleanups: (()=>void)[] = [];

	goto(i:number):void { this.#goto(i); }

	public get currentIndex():number { return this.#image.canvas?.activeImageIdx ?? -1; }

	constructor(
		micrio:HTMLMicrioElement,
		image:MicrioImage,
		parent:HTMLElement,
		preloadRangeFn:(center:number,total:number,d:number,getTile:(idx:number)=>{baseTileIdx:number;thumbSrc?:string}|undefined,engine:any,hasArchive:boolean)=>void
	) {
		this.#micrio = micrio;
		this.#image = image;
		this.#parent = parent;
		this.#preloadRangeFn = preloadRangeFn;
	}

	async setup() : Promise<void> {
		const micrio = this.#micrio;
		const image = this.#image;
		const parent = this.#parent;

		const bundle = DataLoader.getBundleImageSync(image.id);
		if (!bundle) return;

		const settings = image.$settings;
		const omni = settings.omni;
		if (!omni) return;

		const engine = micrio.engine;
		const info = image.$info;
		if (!info) return;

		const totalFrames = omni.frames;
		const numLayers = omni.layers?.length ?? 1;
		const pagesPerLayer = totalFrames / numLayers;

		if (!image.placed) return;

		const frames: Omni.Frame[] = [];
		for (let j = 0; j < totalFrames; j++) {
			const frame: Omni.Frame = {
				id: info.id + '/' + j,
				image,
				visible: writable(false),
				frame: j,
				opts: { area: [0, 0, 1, 1] },
				placed: false,
				baseTileIdx: -1,
				thumbSrc: image.getTileSrc(image.levels, 0, 0, j),
			};
			engine.addEmbed(frame, image, { opacity: 0, asImage: false });
			frames.push(frame);
		}

		if (bundle.settings?.omni && parseFloat(bundle.info.version) >= 5) {
			await archive.load(
				bundle.info.tileBasePath || bundle.info.path,
				(bundle.info.tilesId ?? bundle.info.id) + '/base',
				(p:number) => micrio._ui?.setProps?.({loadingProgress: p})
			).catch(() => {});
		}

		image.canvas?.setActiveImage(0, 0);
		engine.render();

		const hasArchive = !!image.$settings.gallery?.archive;
		const preloadD = 'requestIdleCallback' in self
			? Math.max(36, Math.floor(totalFrames / 8) * 2)
			: 50;

		const preload = (c: number) => {
			this.#preloadRangeFn(c, totalFrames, preloadD,
				idx => frames[idx] ? { baseTileIdx: frames[idx].baseTileIdx, thumbSrc: frames[idx].thumbSrc } : undefined,
				engine, hasArchive);
		};

		const dial = createElement('micrio-dial', {
			parent,
			setProps: {
				currentRotation: 0, frames: pagesPerLayer, degrees: true,
				onturn: (frame: number) => {
					this.goto(Math.round(frame) % pagesPerLayer);
				}
			}
		}) as MicrioElement;

		this.#swiperLength = pagesPerLayer;
		this.#swiperOpts = { continuous: true };

		this.#goto = (idx: number) => {
			while (idx < 0) idx += pagesPerLayer;
			idx %= pagesPerLayer;
			image.canvas?.setActiveImage(idx, 0);
			dial.setProps?.({ currentRotation: (idx / pagesPerLayer) * 360 });
			preload(idx);
			engine.render();
		};

		this.#initSwiper();
		image.omni = this;
		preload(0);

		this.#cleanups.push(
			image.state.layer.subscribe((idx: number) => {
				dial.setProps?.({ currentRotation: (idx / pagesPerLayer) * 360 });
			})
		);

		const omniCfg = image.$settings.omni;
		const omniNumLayers = omniCfg?.layers?.length ?? 1;
		if (omniNumLayers > 1) {
			const layerNames = omniCfg!.layers!.map((l: any, i: number) => ({
				i18n: Object.fromEntries(Object.entries(l.i18n || {}).map(([lang, name]: [string, any]) => [lang, { title: name ?? 'Layer ' + (i + 1) }]))
			}));
			const langs = Object.keys(info.revision ?? {}) as string[];
			if (!langs.length) {
				const ml = get(micrio._lang);
				if (ml) langs.push(ml);
			}
			if (langs.length) {
				for (const lang of langs) {
					for (let i = 0; i < layerNames.length; i++) {
						if (!layerNames[i].i18n[lang])
							layerNames[i].i18n[lang] = { title: 'Layer ' + (i + 1) };
					}
				}
			}
			const printLayerMenu = () => {
				const currentLayer = get(image.state.layer);
				image.data.update((d: any) => {
					if (!d) d = {};
					if (!d.pages) d.pages = [];
					d.pages = d.pages.filter((p: any) => !p.id?.startsWith('_omni-layers'));
					d.pages.push({
						id: '_omni-layers-' + currentLayer,
						i18n: layerNames[currentLayer].i18n,
						icon: icons.layerGroup,
						children: layerNames.map((title: any, i: number) => ({
							id: 'omni-layer-' + i,
							i18n: title.i18n,
							action: () => {
								image.state.layer.set(i);
								preload(get(image.state.layer) * Math.floor(totalFrames / omniNumLayers));
							}
						})).filter((p: any) => p.id != 'omni-layer-' + currentLayer)
					});
					return d;
				});
			};
			printLayerMenu();
			this.#cleanups.push(image.state.layer.subscribe(printLayerMenu));
		}
	}

	destroy() : void {
		this.#cleanSwiper();
		for (const cleanup of this.#cleanups) cleanup();
		this.#cleanups = [];
	}

	// ─── Swipe gesture handlers (was GallerySwiper) ──────────────

	#initSwiper() {
		const micrio = this.#micrio;

		if(!this.#swiperOpts.sensitivity) this.#swiperOpts.sensitivity = Number(micrio.getAttribute('data-swipe-sensitivity') ?? 1);

		const snap = micrio.getAttribute('data-swipe-snap');
		if(snap) this.#snapTo = snap.split(',').map(Number);

		this.#micrio.setAttribute('data-hooked','');

		this.#image.state.view.subscribe(v =>
			this.#isFullWidth = this.#swiperOpts.coverLimit ? this.#image.camera.isZoomedOut()
				: v ? Math.round(v[3]*1000)/1000 >= 1 : true
		);

		micrio.engine.noPinchPan = true;
		micrio.engine.isSwipe = true;

		this.#micrio.canvas.element.addEventListener('pointerdown', this.#dStart);
	}

	#cleanSwiper() {
		this.#micrio.canvas.element.removeEventListener('pointerdown', this.#dStart);
		this.#pointers.clear();
		this.#removeSwipeListeners();
	}

	#removeSwipeListeners() {
		this.#micrio.removeEventListener('pointermove', this.#dMove);
		this.#micrio.removeEventListener('pointerup', this.#dStop);
	}

	#isDragging = () : boolean => this.#pointers.size == 2 || (this.#isFullWidth || this.#startedWithShift) && this.#pointers.size == 1;

	#dStart = (e:PointerEvent):void => {
		if (e.button !== 0) return;
		this.#startedWithShift = e.shiftKey;
		const newDrag = !this.#isDragging();
		this.#pointers.set(e.pointerId, true);
		if(this.#pointers.size > 2) { this.#pointers.clear(); this.#removeSwipeListeners(); return; }

		if(newDrag) {
			this.#hitTresh = false;
			this.#micrio.setAttribute('data-panning','');
			this.#startIndex = this.currentIndex;
			this.#startX = e.clientX;
			this.#firstTouchId = e.pointerId;
			this.#micrio.addEventListener('pointermove', this.#dMove);
			this.#micrio.addEventListener('pointerup', this.#dStop);
			this.#micrio.setPointerCapture(e.pointerId);
		}
	}

	#dMove = (e:PointerEvent):void => {
		if(!this.#isDragging() || e.pointerId != this.#firstTouchId
			|| this.#startX === undefined || this.#startIndex === undefined) return;

		if(!this.#hitTresh && this.#startX !== undefined && (
			this.#hitTresh = this.#pointers.size != 2 ? true
				: Math.abs(e.clientX - this.#startX) > ((this.#micrio.events.pinchFactor && this.#micrio.events.pinchFactor > 1.25 ? 0.3 : 0.15) * this.#micrio.offsetWidth)
		)) this.#startX = e.clientX;
		if(!this.#hitTresh) return;

		const camera = this.#micrio.$current!.camera;
		const scale = !this.#swiperOpts.continuous ? 1 : Math.max(0.1, (camera.getXY(1, .5)[0] - camera.getXY(0, .5)[0]) / this.#micrio.offsetWidth);
		const delta = Math.round((e.clientX - this.#startX) / (this.#micrio.offsetWidth * scale) * this.#swiperLength * (this.#swiperOpts.sensitivity ?? 1));
		let idx = this.#startIndex - delta;

		if(this.#swiperOpts.continuous) {
			while(idx < 0) idx += this.#swiperLength;
			while(idx > this.#swiperLength-1) idx -= this.#swiperLength;
		}

		idx = Math.max(0, Math.min(this.#swiperLength-1, idx));

		if(idx != this.currentIndex) this.#goto(idx);
	}

	#dStop = (e:PointerEvent):void => {
		this.#pointers.delete(e.pointerId);
		if(e.pointerId == this.#firstTouchId) {
			this.#micrio.releasePointerCapture(this.#firstTouchId);
			this.#firstTouchId = undefined;
		}
		if(!this.#pointers.size) this.#swipeEnd();
	}

	#swipeEnd():void {
		this.#micrio.removeAttribute('data-panning');
		this.#removeSwipeListeners();
		this.#hitTresh = false;

		if(this.#snapTo.length) {
			const snapToIndex = this.#snapTo[this.#snapTo.map((i,idx) => [idx, Math.abs(i-this.currentIndex)])
				.sort((a,b) => a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0)[0][0]];
			if(snapToIndex != this.currentIndex) this.animateTo(snapToIndex);
		}
	}

	public animateTo(idx: number) : void {
		if(this.#raf) cancelAnimationFrame(this.#raf);
		const duration = 250,
			started = performance.now(),
			startIdx = this.currentIndex,
			delta = startIdx - idx;

		const frame = (time:number) => {
			const p = Math.min(1, (time - started) / duration);
			if(p < 1) this.#raf = requestAnimationFrame(frame);
			const d = startIdx - Math.round(easeInOut.get(p) * delta);
			if(d != this.currentIndex) this.#goto(d);
		}

		this.#raf = requestAnimationFrame(frame);
	}

}
