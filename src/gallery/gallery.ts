import { MicrioElement } from '$core/component';
import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';
import type { Gallery as GalleryController } from '$gallery/controller';
import type { Engine } from '$render/engine';
import type { Models } from '$types/models';
import { archive } from '$utils/archive';
import { i18n } from '$core/i18n/strings';
import { get, writable } from '$core/store';
import { OmniUI } from '$gallery/omni';
import { SwipeGallery } from '$gallery/swipe';
import { createElement } from '$utils/dom';
import '$ui/button';

const scrubPad = 16;

/** Properties for the {@link MicrioGallery} custom element. @internal */
export interface GalleryProps {
	controller?: GalleryController;
}

interface BookViewer3D {
	goto: (n:number) => void;
	zoom: (delta:number) => void;
	isZoomedIn: () => boolean;
};

import './gallery.css';

/**
 * Handles gallery navigation UI (scrubber, prev/next, strip-swipe) and omni 3D object rotation.
 * Two modes: standard gallery (scrubber + arrow buttons, with optional strip-swipe)
 * and omni (dial + swipe gesture + layer menu).
 */
class MicrioGallery extends MicrioElement<GalleryProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-gallery';

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
	/** @internal */
	#_ul: HTMLElement | null = null;
	#prevBtn: MicrioElement | null = null;
	#nextBtn: MicrioElement | null = null;
	/** @internal */
	#_left = 0;
	#hoverIdx = -1;
	#dragging = false;
	#dragIsPointer = false;
	#box: DOMRect | null = null;
	/** OmniUI instance when the current image is an omni 3D object. */
	#omni: OmniUI|undefined;
	/** SwipeGallery instance when this is a strip-swipe gallery. */
	#swipeGallery: SwipeGallery|undefined;
	/** Map tracking in-flight preload requests (keyed by thumbSrc). */
	#preloading = new Map<string, any>();
	#preloadD = 0;

	/** 3d book viewer @internal */
	#book3d: BookViewer3D | undefined;


	/** @internal */
	async _onMount() {
		const micrio = this._getMicrio();
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

	/** @internal */
	_setProps(props: Partial<GalleryProps>) {
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
		if (this.#book3d) {
			this.#book3d.goto(page)
		} else if (this.#swipeGallery) {
			this.#swipeGallery.animateTo(imgIdx, fast, duration, this.#currentImageIdx);
		} else if (changed) {
			const pageImages = this.#pageToImages[page];
			const num = (pageImages?.length ?? 1) - 1;
			this.#parentImage.canvas?._setActiveImage(imgIdx, num);
			this.#parentImage.camera.setView([0, 0, 1, 1]);
		}
		this.#parentImage.album!.hooked = true;
	}

	/** Called when the current page changes: dispatches event, preloads images, updates UI. */
	#frameChanged() {
		this.#preload(this.#currentImageIdx);
		const micrio = this._getMicrio();
		micrio?.events._dispatch('gallery-show', (this.#pageToImages[this.#currentPage] ?? []).map(i => this.#images[i].id));
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
		const micrio = this._getMicrio();
		if (!micrio) return;
		micrio._keepRendering = this.#dragging = true;
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
		const micrio = this._getMicrio();
		if (!micrio) return;
		this.#dragging = micrio._keepRendering = false;
		this.#goto(this.#currentPage);
	};

	// ─── Preloading (eager thumbnail loading for nearby pages) ─────

	/**
	 * Preloads thumbnail textures within a range around a center index.
	 * Uses requestIdleCallback for low-priority texture loading.
	 */
	#preloadRange(center: number, total: number, d: number, getTile: (idx: number) => { baseTileIdx: number; thumbSrc?: string } | undefined, engine: Engine, hasArchive: boolean) {
		if (!total || !engine?.ready) return;
		const request: any = self.requestIdleCallback ?? self.requestAnimationFrame;
		for (let x = -d; x <= d; x++) {
			if (!x) continue;
			let rX = center + x;
			while (rX < 0) rX += total;
			while (rX >= total) rX -= total;
			const tile = getTile(rX);
			if (tile?.thumbSrc && !this.#preloading.has(tile.thumbSrc)) {
				this.#preloading.set(tile.thumbSrc, request(() =>
					engine._getTexture(tile.baseTileIdx, tile.thumbSrc!, false, { force: hasArchive })
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
			idx => images[idx] ? { baseTileIdx: images[idx]._baseTileIdx, thumbSrc: images[idx].thumbSrc } : undefined,
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
	};

	// ─── Standard gallery render (scrubber + strip-swipe) ──────────

	/**
	 * Renders the standard gallery UI: scrubber bar, prev/next buttons,
	 * registers images with the engine, and sets up input handlers.
	 */
	async #renderGallery(micrio: HTMLMicrioElement, image: MicrioImage, controller: GalleryController) {
		const images: MicrioImage[] = [...controller._images];
		if (!images.length) return;

		this.#images = images;
		this.#parentImage = image;

		const layout = controller._getPageLayout();
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
		const startImageIdx = controller._config.startId
			? Math.max(0, images.findIndex(i => i.id === controller._config.startId))
			: 0;
		const idx = layout.pages.findIndex(p => p.includes(startImageIdx));
		const pageIdx = idx >= 0 ? idx : 0;

		this.#preloadD = 'requestIdleCallback' in self ? 100 : 50;

		const engine = micrio._engine;
		const parent = image;
		const isSwipe = controller._config.type === 'swipe';
		const isBook3D = controller._config.type === 'book3d';

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
			this.#currentImageIdx = startImageIdx;
			this.#currentPage = pageIdx;
			this.#frameChanged();
			parent.album!.hooked = true;
		} else if (isBook3D) {
			this.#loadBook3d(parent,controller._items,startImageIdx);
		} else {
			// Switch gallery: embed all images on the parent canvas
			await Promise.allSettled(images.map(d => {
				if ('state' in d && !('image' in d)) d.camera = parent.camera;
				return engine._addEmbed(d, parent, { opacity: 0, asImage: 'camera' in d });
			}));
			const pageImages = this.#pageToImages[pageIdx];
			const num = (pageImages?.length ?? 1) - 1;
			parent.canvas?._setActiveImage(pageImages[0], num);
			parent.camera.setView([0, 0, 1, 1]);
			this.#currentPage = pageIdx;
			this.#frameChanged();
			parent.album!.hooked = true;
		}

		// Strip-swipe pointer events on the canvas element
		if (this.#swipeGallery && images.length > 1) {
			micrio.canvas.element.addEventListener('pointerdown', this.#swipeGallery.handlePointerDown);
			this._addCleanup(() => micrio.canvas.element.removeEventListener('pointerdown', this.#swipeGallery!.handlePointerDown));
		}

		window.addEventListener('keydown', this.#keydown);
		this._addCleanup(() => window.removeEventListener('keydown', this.#keydown));
	}

	#loadBook3d(parent:MicrioImage, items: Models.ImageInfo.ImageInfo[], pageIdx:number) : void {
		// Book3D album: the album ships its own WebGL renderer for the shared
		// `<canvas>`, so no engine instancing happens here. Keep all DOM UI
		// (scrubber, prev/next, keyboard nav, album API, gallery-show) intact,
		// and mark the pages visible so their markers render.
		if(!('MicrioBook3D' in window)) throw new Error('Could not load Micrio Book3D viewer')
		for (const img of this.#images) img.visible.set(true);
		parent.album!.hooked = true;
		this.#book3d = new ((window.MicrioBook3D) as any)({
			canvas: parent.engine.micrio.canvas.element,
			bookIndex: {
				images: items,
				delta: 0
			},
			startPageIdx: pageIdx,
			getImageById: archive._getImageById,
			onPageChange: (p:number) => this.#goto(p)
		}) as BookViewer3D;
		parent.engine.micrio.events.unhookScroll();
		parent.camera._zoomOverride = (n:number) => this.#book3d!.zoom(n);
	}

	/** Builds the scrubber bar DOM (ticks, track, handle, prev/next buttons). */
	#buildScrubber() {
		const total = this.#pageToImages.length;
		if (!this.#images.length || total <= 1 || this.querySelector('ul')) return;
		const $i18n = get(i18n);
		const dense = total > 24;
		const tickStep = dense ? Math.max(1, Math.ceil(total / 24)) : 1;
		const curr = this.#currentPage;

		this.#prevBtn = createElement('micrio-button', {
			parent: this,
			setProps: {
				type: 'prev', title: $i18n._galleryPrev,
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

		const trackFill = createElement('span');
		createElement('span', { parent: ul, children: [trackFill] });

		createElement('span', {
			parent: ul,
			children: Array.from({ length: total }, (_, i) => {
				if (dense && i % tickStep !== 0 && i !== total - 1) return null;
				return createElement('span', {
					attrs: dense && i % (tickStep * 5) === 0 ? { 'data-major': '' } : {},
					style: { left: `${total > 1 ? (i / (total - 1)) * 100 : 50}%` }
				});
			})
		});

		createElement('button', {
			parent: ul,
			props: { role: 'slider', tabIndex: 0 },
			attrs: { 'aria-label': 'Gallery position', 'aria-valuemin': '1', 'aria-valuemax': String(total) }
		});

		createElement('span', { parent: ul });

		this.#nextBtn = createElement('micrio-button', {
			parent: this,
			setProps: {
				type: 'next', title: $i18n._galleryNext,
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

		const trackFill = this.querySelector('ul > :first-child > span') as HTMLElement;
		if (trackFill) trackFill.style.width = `${fillPct}%`;

		const allTicks = this.querySelectorAll('ul > :nth-child(2) > span');
		const visibleTicks: number[] = [];
		for (let i = 0; i < total; i++) {
			if (!dense || i % tickStep === 0 || i === total - 1 || i === curr) visibleTicks.push(i);
		}
		allTicks.forEach((tick, idx) => {
			const i = visibleTicks[idx];
			if (i === undefined) return;
			tick.toggleAttribute('data-active', i === curr);
			tick.toggleAttribute('data-hover', i === this.#hoverIdx);
		});

		const handle = this.querySelector('ul > button') as HTMLElement;
		if (handle) {
			handle.style.left = `${left}px`;
			handle.classList.toggle('dragging', this.#dragging);
			handle.setAttribute('aria-valuenow', String(curr + 1));
		}

		const hl = this.querySelector('ul > button + span') as HTMLElement;
		if (hl) {
			hl.style.left = `${left}px`;
			hl.classList.toggle('dragging', this.#dragging);
			const pageTotal = this.#pageToImages.reduce((n, p) => n + p.length, 0);
			hl.textContent = this.#pageLabel(curr) + (dense ? ` / ${pageTotal}` : '');
		}

		let hoverLabel = this.querySelector('[data-part="hover-label"]') as HTMLElement;
		if (this.#hoverIdx >= 0 && this.#hoverIdx !== curr && !this.#dragging) {
			if (!hoverLabel) {
				hoverLabel = createElement('span', { attrs: { 'data-part': 'hover-label' }, parent: this.querySelector('ul') ?? undefined });
			}
			hoverLabel.style.left = `${total > 1 ? (this.#hoverIdx / (total - 1)) * 100 : 50}%`;
			hoverLabel.textContent = this.#pageLabel(this.#hoverIdx);
		} else {
			hoverLabel?.remove();
		}

		if (this.#prevBtn) (this.#prevBtn.querySelector('button') as HTMLButtonElement | null)?.toggleAttribute('disabled', curr <= 0);
		if (this.#nextBtn) (this.#nextBtn.querySelector('button') as HTMLButtonElement | null)?.toggleAttribute('disabled', curr >= total - 1);
	}

	/** @internal */
	_onDestroy() {
		this.#omni?.destroy();
		this.#swipeGallery?.destroy();
	}
}

customElements.define(MicrioGallery.tag, MicrioGallery);
