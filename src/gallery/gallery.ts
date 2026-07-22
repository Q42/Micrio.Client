import { MicrioElement } from '$core/component';
import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';
import type { Gallery as GalleryController } from '$gallery/controller';
import { i18n } from '$core/i18n/strings';
import { get, writable } from '$core/store';
import { OmniUI } from '$gallery/omni';
import { SwipeGallery } from '$gallery/swipe';
import { createElement } from '$utils/dom';
import '$ui/button';

const scrubPad = 16;

export interface GalleryProps {
	controller?: GalleryController;
}

/**
 * Handles gallery navigation UI (scrubber, prev/next, strip-swipe) and omni 3D object rotation.
 * Two modes: standard gallery (scrubber + arrow buttons, with optional strip-swipe)
 * and omni (dial + swipe gesture + layer menu).
 */
class MicrioGallery extends MicrioElement<GalleryProps> {
	static tag = 'micrio-gallery';
	static styles = `
micrio-gallery .gallery-btn {
	position: absolute;
	top: 50%;
	transform: translate(0,-50%);
	transition: transform .25s ease,opacity .25s ease;
}
micrio-gallery .gallery-btn.prev {
	left: var(--micrio-border-margin);
}
micrio-gallery .gallery-btn.next {
	right: var(--micrio-border-margin);
}
micrio-gallery ul {
	position: absolute;
	bottom: var(--micrio-border-margin);
	left: 50%;
	transform: translateX(-50%);
	display: block;
	list-style-type: none;
	background: var(--micrio-button-background,var(--micrio-background,none));
	box-shadow: var(--micrio-button-shadow);
	backdrop-filter: var(--micrio-background-filter);
	border-radius: var(--micrio-border-radius);
	padding: 0 16px;
	margin: 0;
	height: var(--micrio-button-size);
	color: var(--micrio-color);
	transition: transform .25s ease,opacity .25s ease;
	max-width: calc(100vw - 50px);
	max-width: calc(100cqw - 50px);
	width: 520px;
	touch-action: none;
	cursor: pointer;
}
@media (max-width: 500px) {
	micrio-gallery ul {
		left: var(--micrio-border-margin);
		right: calc(var(--micrio-button-size) + var(--micrio-border-margin) * 2);
		width: auto;
		transform: none;
	}
}
micrio-gallery .track {
	position: absolute;
	top: 50%;
	left: 16px;
	right: 16px;
	height: 2px;
	background: var(--micrio-scrubber-background);
	border-radius: 2px;
	transform: translateY(-50%);
	pointer-events: none;
	overflow: hidden;
}
micrio-gallery .track-fill {
	display: block;
	position: absolute;
	top: 0;
	left: 0;
	height: 100%;
	background: var(--micrio-color);
	border-radius: 2px;
	opacity: .85;
	transition: width .15s ease;
}
micrio-gallery .ticks {
	position: absolute;
	top: 0;
	left: 16px;
	right: 16px;
	bottom: 0;
	pointer-events: none;
}
micrio-gallery .tick {
	position: absolute;
	top: 50%;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--micrio-color);
	opacity: .55;
	transform: translate(-50%,-50%);
	transition: opacity .2s ease,transform .2s ease,background-color .2s ease;
}
micrio-gallery .tick.active {
	opacity: 1;
	transform: translate(-50%,-50%) scale(1.6);
	background: var(--micrio-color-hover,var(--micrio-color));
}
@media (hover: hover) {
	micrio-gallery .tick.hover {
		opacity: 1;
		transform: translate(-50%,-50%) scale(1.4);
	}
}
micrio-gallery ul.dense .tick {
	width: 1.5px;
	height: 8px;
	border-radius: 1px;
	opacity: .35;
	transform: translate(-50%,-50%);
}
micrio-gallery ul.dense .tick.major {
	height: 12px;
	opacity: .6;
}
micrio-gallery ul.dense .tick.active {
	width: 2px;
	height: 14px;
	opacity: 1;
	background: var(--micrio-color-hover,var(--micrio-color));
	transform: translate(-50%,-50%);
}
@media (hover: hover) {
	micrio-gallery ul.dense .tick.hover {
		opacity: .9;
		transform: translate(-50%,-50%);
	}
}
micrio-gallery .hover-label {
	position: absolute;
	bottom: calc(100% + 6px);
	transform: translateX(-50%);
	padding: 2px 8px;
	font-size: 11px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	line-height: 1.4;
	color: var(--micrio-color);
	background: var(--micrio-popover-background);
	backdrop-filter: var(--micrio-background-filter);
	border-radius: 999px;
	box-shadow: var(--micrio-button-shadow);
	pointer-events: none;
	white-space: nowrap;
}
micrio-gallery .handle {
	position: absolute;
	top: 50%;
	left: 0;
	height: 28px;
	min-width: 28px;
	padding: 0;
	box-sizing: border-box;
	background: var(--micrio-color);
	border: 2px solid var(--micrio-color);
	border-radius: 999px;
	cursor: ew-resize;
	touch-action: none;
	transform: translate(-50%,-50%);
	transition: left .15s ease,height .15s ease,min-width .15s ease,background-color .2s ease,box-shadow .2s ease;
	box-shadow: 0 2px 8px rgba(0,0,0,.35),0 0 0 0 var(--micrio-color-hover);
}
micrio-gallery .handle:hover {
	box-shadow: 0 2px 8px rgba(0,0,0,.4),0 0 0 4px rgba(255,255,255,.12);
}
micrio-gallery .handle.dragging {
	transition: none;
	box-shadow: 0 2px 12px rgba(0,0,0,.5),0 0 0 6px rgba(255,255,255,.15);
	cursor: grabbing;
}
micrio-gallery .handle-label {
	position: absolute;
	bottom: calc(100% + 8px);
	left: 0;
	transform: translateX(-50%);
	padding: 3px 9px;
	font-size: 12px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	line-height: 1.4;
	color: var(--micrio-color);
	background: var(--micrio-popover-background);
	backdrop-filter: var(--micrio-background-filter);
	border-radius: 999px;
	box-shadow: var(--micrio-button-shadow);
	pointer-events: none;
	white-space: nowrap;
	transition: left .15s ease,transform .15s ease;
}
micrio-gallery .handle-label.dragging {
	transition: none;
	transform: translateX(-50%) scale(1.05);
}
micr-io.hide-ui micrio-gallery:not(:hover) ul,micrio-gallery.force-hidden ul {
	transform: translate(-50%,calc(100% + var(--micrio-border-margin)));
	opacity: 0;
	pointer-events: none;
}
@media (max-width: 500px) {
	micr-io.hide-ui micrio-gallery:not(:hover) ul,micrio-gallery.force-hidden ul {
		transform: translateY(calc(100% + var(--micrio-border-margin)));
	}
}
micr-io.hide-ui micrio-gallery:not(:hover) .gallery-btn.prev,micrio-gallery.force-hidden .gallery-btn.prev {
	transform: translate(calc(-100% - var(--micrio-border-margin)),-50%);
	opacity: 0;
	pointer-events: none;
}
micr-io.hide-ui micrio-gallery:not(:hover) .gallery-btn.next,micrio-gallery.force-hidden .gallery-btn.next {
	transform: translate(calc(100% + var(--micrio-border-margin)),-50%);
	opacity: 0;
	pointer-events: none;
}
micrio-gallery .gallery-btn:disabled {
	opacity: 0;
	pointer-events: none;
}
micrio-gallery .gallery-btn.micrio-button:hover,micrio-gallery .gallery-btn.micrio-button:focus {
	position: absolute !important;
}
`;

	#props: GalleryProps = {};
	/** Current page index (0-based) in the gallery timeline. */
	#currentPage = -1;
	/** Index of the first image in the current page. */
	#currentImageIdx = 0;
	/** All MicrioImage instances in this gallery. */
	#images: MicrioImage[] = [];
	/** Logical page layout: array of image index arrays per page (for spreads). */
	#pageToImages: number[][] = [];
	/** Pre-computed X position per image slot for strip-layout. */
	#imageSlotPos: number[] = [];
	/** Pre-computed width per image slot for strip-layout. */
	#imageSlotWidth: number[] = [];
	/** The parent MicrioImage hosting this gallery (switch/omni). */
	#parentImage!: MicrioImage;
	#_ul: HTMLElement | null = null;
	#prevBtn: MicrioElement | null = null;
	#nextBtn: MicrioElement | null = null;
	#_left = 0;
	#hoverIdx = -1;
	#dragging = false;
	#dragIsPointer = false;
	#box: DOMRect | null = null;
	/** Auto-hide enabled (UI hides after 2s of inactivity). */
	#autoHide = true;
	/** Timeout ID for auto-hide. */
	#to: number | undefined;
	/** OmniUI instance when the current image is an omni 3D object. */
	#omni: OmniUI|undefined;
	/** SwipeGallery instance when this is a strip-swipe gallery. */
	#swipeGallery: SwipeGallery|undefined;
	/** Map tracking in-flight preload requests (keyed by thumbSrc). */
	#preloading = new Map<string, any>();
	#preloadD = 0;

	async onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const image = micrio.$current as MicrioImage;
		if (!image) return;

		const settings = image.$settings;
		if (settings?.omni) {
			this.#omni = new OmniUI(micrio, image, this, (c,total,d,getTile,engine,hasArchive) =>
				this.#preloadRange(c,total,d,getTile,engine,hasArchive)
			);
			await this.#omni.setup();
			return;
		}

		const controller = this.#props.controller;
		if (!controller) return;

		this.#renderGallery(micrio, image, controller);
	}

	setProps(props: Partial<GalleryProps>) {
		if (props.controller !== undefined) this.#props.controller = props.controller;
	}

	/** Returns the X pixel position of a page in the scrubber bar. */
	#getX(idx: number): number {
		if (!this.#_ul) return 0;
		const w = this.#_ul.clientWidth;
		const max = Math.max(1, this.#pageToImages.length - 1);
		return scrubPad + (idx / max) * (w - scrubPad * 2);
	}

	/** Returns a human-readable page label (e.g. "3" or "5-6" for spreads). */
	#pageLabel(idx: number): string {
		const imgs = this.#pageToImages[idx];
		if (!imgs || imgs.length <= 1) return String(idx + 1);
		return `${imgs[0] + 1}-${imgs[imgs.length - 1] + 1}`;
	}

	/** Resets auto-hide timer on user activity. */
	#activity = () => {
		const parent = this.getMicrio();
		if (!parent) return;
		if (parent.classList.contains('hide-ui')) {
			parent.classList.remove('hide-ui');
			this.#updateScrubber();
		}
		clearTimeout(this.#to);
		if (this.#autoHide) this.#to = window.setTimeout(() => {
			if (!parent.classList.contains('hide-ui')) {
				parent.classList.add('hide-ui');
				this.#updateScrubber();
			}
		}, 2000);
	}

	/**
	 * Navigates to a specific page in the gallery.
	 * @param i Target page index.
	 * @param fast If true, uses a faster transition.
	 * @param duration Transition duration in ms.
	 * @param force Force navigation even if page hasn't changed.
	 */
	#goto(i: number, fast = false, duration = 150, force = false) {
		const images = this.#images;
		if (!images.length) return;
		const page = Math.round(Math.max(0, Math.min(this.#pageToImages.length - 1, i)));
		const imgIdx = this.#pageToImages[page]?.[0] ?? 0;
		const changed = force || page !== this.#currentPage;
		this.#currentPage = page;
		this.#currentImageIdx = imgIdx;
		if (changed) this.#frameChanged();
		if (this.#swipeGallery) {
			this.#swipeGallery.animateTo(imgIdx, fast, duration, this.#currentImageIdx);
		} else if (changed) {
			const pageImages = this.#pageToImages[page];
			const num = (pageImages?.length ?? 1) - 1;
			this.#parentImage.canvas?.setActiveImage(imgIdx, num);
			if (num > 0) {
				this.#parentImage.camera.setView([0, 0, 1, 1]);
			} else {
				const area = this.#images[imgIdx]?.opts?.area;
				if (area) this.#parentImage.camera.setView(area);
			}
		}
		this.#parentImage.album!.hooked = true;
	}

	/** Called when the current page changes: dispatches event, preloads images, updates UI. */
	#frameChanged() {
		this.#preload(this.#currentImageIdx);
		const micrio = this.getMicrio();
		micrio?.events.dispatch('gallery-show', this.#currentPage);
		if (this.#swipeGallery) {
			this.#parentImage.album?.currentImage?.set(this.#images[this.#currentImageIdx] as MicrioImage);
		}
		this.#updateScrubber();
	}

	// ─── Scrubber (clickable timeline bar) ─────────────────────────

	/** Initiates a scrub drag (pointer or touch). */
	#scrubStart = (e: PointerEvent | TouchEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (this.#dragging || (this.#dragIsPointer = 'button' in e) && e.button !== 0 || !this.#_ul) return;
		this.#box = this.#_ul.getBoundingClientRect();
		const micrio = this.getMicrio();
		if (!micrio) return;
		micrio.keepRendering = this.#dragging = true;
		this.#hoverIdx = -1;
		window.addEventListener(this.#dragIsPointer ? 'pointermove' : 'touchmove', this.#scrubMove);
		window.addEventListener(this.#dragIsPointer ? 'pointerup' : 'touchend', this.#scrubStop);
		this.#scrubMove(e);
	};

	/** Returns [0-1 progress, page index] for a pointer/touch event on the scrubber. */
	#getScrubXPercIdx(e: PointerEvent | TouchEvent): [number, number] {
		const _box = this.#box ?? this.#_ul!.getBoundingClientRect();
		const total = this.#pageToImages.length;
		const clientX = 'button' in e ? e.clientX : (e as TouchEvent).touches[0].clientX;
		const perc = Math.min(1, Math.max(0, (clientX - _box.left - scrubPad) / (_box.width - scrubPad * 2)));
		const idx = Math.max(0, Math.min(total - 1, Math.round(perc * Math.max(1, total - 1))));
		return [perc, idx];
	}

	/** Updates scrubber position during drag. */
	#scrubMove = (e: PointerEvent | TouchEvent) => {
		const [perc, idx] = this.#getScrubXPercIdx(e);
		this.#_left = scrubPad + perc * (this.#box!.width - scrubPad * 2);
		if (idx !== this.#currentPage) this.#goto(idx, true);
	};

	/** Tracks hover position on scrubber (when not dragging). */
	#scrubPointerMove = (e: PointerEvent | TouchEvent) => {
		if (!this.#dragging) this.#hoverIdx = this.#getScrubXPercIdx(e)[1];
		this.#updateScrubber();
	};

	/** Ends scrub drag. */
	#scrubStop = () => {
		window.removeEventListener(this.#dragIsPointer ? 'pointermove' : 'touchmove', this.#scrubMove);
		window.removeEventListener(this.#dragIsPointer ? 'pointerup' : 'touchend', this.#scrubStop);
		const micrio = this.getMicrio();
		if (!micrio) return;
		this.#dragging = micrio.keepRendering = false;
		this.#goto(this.#currentPage);
	};

	// ─── Preloading (eager thumbnail loading for nearby pages) ─────

	/**
	 * Preloads thumbnail textures within a range around a center index.
	 * Uses requestIdleCallback for low-priority texture loading.
	 */
	#preloadRange(center: number, total: number, d: number, getTile: (idx: number) => { baseTileIdx: number; thumbSrc?: string } | undefined, engine: any, hasArchive: boolean) {
		if (!total || !engine) return;
		const request: any = self.requestIdleCallback ?? self.requestAnimationFrame;
		for (let x = -d; x <= d; x++) {
			if (!x) continue;
			let rX = center + x;
			while (rX < 0) rX += total;
			while (rX >= total) rX -= total;
			const tile = getTile(rX);
			if (tile?.thumbSrc && !this.#preloading.has(tile.thumbSrc)) {
				this.#preloading.set(tile.thumbSrc, request(() =>
					engine.getTexture(tile.baseTileIdx, tile.thumbSrc!, false, { force: hasArchive })
				));
			}
		}
	}

	/** Preloads gallery thumbnails around a given page index (used by standard gallery nav). */
	#preload(c: number) {
		const images = this.#images;
		if (!images.length || images.length <= 1) return;
		const engine = images[0].engine;
		const hasArchive = !!(images[0]?.$settings?.gallery?.archive);
		this.#preloadRange(c, images.length, this.#preloadD,
			idx => images[idx] ? { baseTileIdx: images[idx].baseTileIdx, thumbSrc: images[idx].thumbSrc } : undefined,
			engine, hasArchive);
	}

	// ─── Keyboard ──────────────────────────────────────────────────

	#keydown = (e: KeyboardEvent) => {
		switch (e.key) {
			case 'PageUp':
			case 'ArrowLeft': this.#goto(this.#currentPage - 1, true); break;
			case 'PageDown':
			case 'ArrowRight': this.#goto(this.#currentPage + 1, true); break;
			case 'Home': this.#goto(0); break;
			case 'End': this.#goto(this.#pageToImages.length - 1); break;
			default: return;
		}
		this.#activity();
	};

	// ─── Standard gallery render (scrubber + strip-swipe) ──────────

	/**
	 * Renders the standard gallery UI: scrubber bar, prev/next buttons,
	 * registers images with the engine, and sets up input handlers.
	 */
	async #renderGallery(micrio: HTMLMicrioElement, image: MicrioImage, controller: GalleryController) {
		const images: MicrioImage[] = [...controller.images];
		if (!images.length) return;

		this.#images = images;
		this.#parentImage = image;

		const layout = controller.getPageLayout();
		this.#pageToImages = layout.pages;

		// Precompute per-image slot positions and widths for spread-aware strip layout
		this.#imageSlotPos = [];
		this.#imageSlotWidth = [];
		for (const [pageIdx, imgs] of layout.pages.entries()) {
			const n = imgs.length;
			for (let j = 0; j < n; j++) {
				this.#imageSlotPos[imgs[j]] = pageIdx + j / n;
				this.#imageSlotWidth[imgs[j]] = 1 / n;
			}
		}
		const startImageIdx = controller.config.startId
			? Math.max(0, images.findIndex(i => i.id === controller.config.startId))
			: 0;
		const idx = layout.pages.findIndex(p => p.includes(startImageIdx));
		const pageIdx = idx >= 0 ? idx : 0;

		this.#preloadD = 'requestIdleCallback' in self ? 100 : 50;

		const engine = micrio.engine;
		const parent = image;
		const isSwipe = controller.config.type === 'swipe';

		if (isSwipe) {
			this.#swipeGallery = new SwipeGallery(micrio, images, this.#pageToImages, this.#imageSlotPos, this.#imageSlotWidth,
				(page) => this.#goto(page),
				() => this.#currentPage
			);
		}

		// Initial scrubber render (before children are ready)
		this.#currentPage = pageIdx;
		this.#buildScrubber();
		this.#updateScrubber();

		// Set up album object for external API access
		const _self = this;
		parent.album = {
			numPages: layout.numPages,
			get currentIndex() { return _self.#currentPage },
			info: parent.$settings.gallery,
			prev: () => _self.#goto(_self.#currentPage - 1),
			next: () => _self.#goto(_self.#currentPage + 1),
			goto: (n: number) => _self.#goto(n),
			...(_self.#swipeGallery ? { currentImage: writable(images[startImageIdx]) } : {}),
		};

		if (this.#swipeGallery) {
			await this.#swipeGallery.setup(startImageIdx, parent, engine);
			this.#currentPage = pageIdx;
			this.#frameChanged();
			parent.album!.hooked = true;
		} else {
			// Switch gallery: embed all images on the parent canvas
			await Promise.allSettled(images.map(d => {
				if ('state' in d && !('image' in d)) d.camera = parent.camera;
				return engine.addEmbed(d, parent, { opacity: 0, asImage: 'camera' in d });
			}));
			const pageImages = this.#pageToImages[pageIdx];
			const num = (pageImages?.length ?? 1) - 1;
			parent.canvas?.setActiveImage(pageImages[0], num);
			if (num > 0) {
				parent.camera.setView([0, 0, 1, 1]);
			} else {
				const area = this.#images[startImageIdx]?.opts?.area;
				if (area) parent.camera.setView(area);
			}
			this.#currentPage = pageIdx;
			this.#frameChanged();
			parent.album!.hooked = true;
		}

		// Auto-hide after a moment
		this.#activity();

		const listen = micrio.canvas.element.addEventListener;
		const unlisten = micrio.canvas.element.removeEventListener;

		// Strip-swipe pointer events on the canvas element
		if (this.#swipeGallery && images.length > 1) {
			listen('pointerdown', this.#swipeGallery.handlePointerDown);
			this.addCleanup(() => unlisten('pointerdown', this.#swipeGallery!.handlePointerDown));
		}

		// Auto-hide listeners
		const unhookActivity = () => {
			unlisten('pointermove', this.#activity);
			unlisten('pointerdown', this.#activity);
		};
		if (this.#autoHide) {
			listen('pointermove', this.#activity);
			listen('pointerdown', this.#activity);
			this.#activity();
		}
		this.addCleanup(unhookActivity);

		window.addEventListener('keydown', this.#keydown);
		this.addCleanup(() => window.removeEventListener('keydown', this.#keydown));

		// Hide when popup/tour is open
		this.addCleanup(micrio.state.popup.subscribe(() => this.#updateScrubber()));
		this.addCleanup(micrio.state.tour.subscribe(() => this.#updateScrubber()));
	}

	/** Builds the scrubber bar DOM (ticks, track, handle, prev/next buttons). */
	#buildScrubber() {
		if (!this.#images.length || this.querySelector('ul')) return;

		const total = this.#pageToImages.length;
		const $i18n = get(i18n);
		const dense = total > 24;
		const tickStep = dense ? Math.max(1, Math.ceil(total / 24)) : 1;
		const curr = this.#currentPage;

		this.#prevBtn = createElement('micrio-button', {
			parent: this,
			setProps: {
				type: 'prev', title: $i18n.galleryPrev, className: 'gallery-btn',
				disabled: curr <= 0,
				onclick: () => this.#goto(this.#currentPage - 1)
			}
		}) as MicrioElement;

		const ul = createElement('ul', {
			className: dense ? 'dense' : '',
			parent: this,
			events: {
				pointerdown: this.#scrubStart as EventListener,
				pointermove: this.#scrubPointerMove as EventListener,
				pointerleave: () => { this.#hoverIdx = -1; this.#updateScrubber(); }
			}
		});
		this.#_ul = ul;
		ul.addEventListener('touchstart', this.#scrubStart, { passive: false });

		const trackFill = createElement('span', { className: 'track-fill' });
		createElement('span', { className: 'track', parent: ul, children: [trackFill] });

		createElement('span', {
			className: 'ticks',
			parent: ul,
			children: Array.from({ length: total }, (_, i) => {
				if (dense && i % tickStep !== 0 && i !== total - 1) return null;
				return createElement('span', {
					className: 'tick' + (dense && i % (tickStep * 5) === 0 ? ' major' : ''),
					style: { left: `${total > 1 ? (i / (total - 1)) * 100 : 50}%` }
				});
			})
		});

		createElement('button', {
			className: 'handle',
			parent: ul,
			props: { role: 'slider', tabIndex: 0 },
			attrs: { 'aria-label': 'Gallery position', 'aria-valuemin': '1', 'aria-valuemax': String(total) }
		});

		createElement('span', { className: 'handle-label', parent: ul });

		this.#nextBtn = createElement('micrio-button', {
			parent: this,
			setProps: {
				type: 'next', title: $i18n.galleryNext, className: 'gallery-btn',
				disabled: curr >= total - 1,
				onclick: () => this.#goto(this.#currentPage + 1)
			}
		}) as MicrioElement;
	}

	/** Updates scrubber bar state: track fill, ticks, handle position, labels. */
	#updateScrubber() {
		const total = this.#pageToImages.length;
		if (!total) return;
		const curr = this.#currentPage;
		const dense = total > 24;
		const tickStep = dense ? Math.max(1, Math.ceil(total / 24)) : 1;
		const fillPct = total > 1 ? (curr / (total - 1)) * 100 : 0;
		const left = this.#_ul && !this.#dragging ? this.#getX(curr) : this.#_left;

		const trackFill = this.querySelector('.track-fill') as HTMLElement;
		if (trackFill) trackFill.style.width = `${fillPct}%`;

		const allTicks = this.querySelectorAll('.tick');
		const visibleTicks: number[] = [];
		for (let i = 0; i < total; i++) {
			if (!dense || i % tickStep === 0 || i === total - 1 || i === curr) visibleTicks.push(i);
		}
		allTicks.forEach((tick, idx) => {
			const i = visibleTicks[idx];
			if (i === undefined) return;
			tick.classList.toggle('active', i === curr);
			tick.classList.toggle('hover', i === this.#hoverIdx);
		});

		const handle = this.querySelector('.handle') as HTMLElement;
		if (handle) {
			handle.style.left = `${left}px`;
			handle.classList.toggle('dragging', this.#dragging);
			handle.setAttribute('aria-valuenow', String(curr + 1));
		}

		const hl = this.querySelector('.handle-label') as HTMLElement;
		if (hl) {
			hl.style.left = `${left}px`;
			hl.classList.toggle('dragging', this.#dragging);
			hl.textContent = this.#pageLabel(curr) + (dense ? ` / ${total}` : '');
		}

		let hoverLabel = this.querySelector('.hover-label') as HTMLElement;
		if (this.#hoverIdx >= 0 && this.#hoverIdx !== curr && !this.#dragging) {
			if (!hoverLabel) {
				hoverLabel = createElement('span', { className: 'hover-label', parent: this.querySelector('ul') ?? undefined });
			}
			hoverLabel.style.left = `${total > 1 ? (this.#hoverIdx / (total - 1)) * 100 : 50}%`;
			hoverLabel.textContent = this.#pageLabel(this.#hoverIdx);
		} else {
			hoverLabel?.remove();
		}

		if (this.#prevBtn) (this.#prevBtn.querySelector('button') as HTMLButtonElement | null)?.toggleAttribute('disabled', curr <= 0);
		if (this.#nextBtn) (this.#nextBtn.querySelector('button') as HTMLButtonElement | null)?.toggleAttribute('disabled', curr >= total - 1);

		const hasPopup = this.getMicrio()?.state.popup ? get(this.getMicrio()!.state.popup) : undefined;
		const hasTour = this.getMicrio()?.state.tour ? get(this.getMicrio()!.state.tour) : undefined;
		this.classList.toggle('force-hidden', !!hasPopup || !!hasTour);
	}

	onDestroy() {
		this.#omni?.destroy();
		this.#swipeGallery?.destroy();
	}
}

customElements.define(MicrioGallery.tag, MicrioGallery);
