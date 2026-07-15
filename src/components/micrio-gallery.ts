import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { MicrioImage } from '$ts/image';
import type { Gallery as GalleryController } from '$ts/gallery';
import { i18n } from '$ts/i18n/strings';
import { get, writable } from '$ts/store';
import { once } from '$ts/utils/store';
import { Enums } from '$ts/enums';
import { GallerySwiper } from '$ts/nav/swiper';
import { icons } from '$ts/icons';
import './micrio-button';
import './micrio-dial';

const horizontalSlot = (offset: number): [number, number, number, number] => [offset, 0, 1, 1];
const scrubPad = 16;

export interface GalleryProps {
	controller?: GalleryController;
}

export class MicrioGallery extends MicrioElement<GalleryProps> {
	static tag = 'micrio-gallery';
	static styles = `micrio-gallery{display:contents}
micrio-gallery .gallery-btn{position:absolute;top:50%;transform:translateY(-50%);transition:transform .25s ease,opacity .25s ease}
micrio-gallery .gallery-btn.arrow-left{left:var(--micrio-border-margin)}
micrio-gallery .gallery-btn.arrow-right{right:var(--micrio-border-margin)}
micrio-gallery ul{position:absolute;bottom:var(--micrio-border-margin);left:50%;transform:translateX(-50%);display:block;list-style-type:none;background:var(--micrio-button-background,var(--micrio-background,none));box-shadow:var(--micrio-button-shadow);backdrop-filter:var(--micrio-background-filter);border-radius:var(--micrio-border-radius);padding:0 16px;margin:0;height:var(--micrio-button-size);color:var(--micrio-color);transition:transform .25s ease,opacity .25s ease;max-width:calc(100vw - 50px);max-width:calc(100cqw - 50px);width:520px;touch-action:none;cursor:pointer}
@media(max-width:500px){micrio-gallery ul{left:var(--micrio-border-margin);right:calc(var(--micrio-button-size) + var(--micrio-border-margin) * 2);width:auto;transform:none}}
micrio-gallery .track{position:absolute;top:50%;left:16px;right:16px;height:2px;background:var(--micrio-scrubber-background);border-radius:2px;transform:translateY(-50%);pointer-events:none;overflow:hidden}
micrio-gallery .track-fill{display:block;position:absolute;top:0;left:0;height:100%;background:var(--micrio-color);border-radius:2px;opacity:.85;transition:width .15s ease}
micrio-gallery .ticks{position:absolute;top:0;left:16px;right:16px;bottom:0;pointer-events:none}
micrio-gallery .tick{position:absolute;top:50%;width:6px;height:6px;border-radius:50%;background:var(--micrio-color);opacity:.55;transform:translate(-50%,-50%);transition:opacity .2s ease,transform .2s ease,background-color .2s ease}
micrio-gallery .tick.active{opacity:1;transform:translate(-50%,-50%) scale(1.6);background:var(--micrio-color-hover,var(--micrio-color))}
@media(hover:hover){micrio-gallery .tick.hover{opacity:1;transform:translate(-50%,-50%) scale(1.4)}}
micrio-gallery ul.dense .tick{width:1.5px;height:8px;border-radius:1px;opacity:.35;transform:translate(-50%,-50%)}
micrio-gallery ul.dense .tick.major{height:12px;opacity:.6}
micrio-gallery ul.dense .tick.active{width:2px;height:14px;opacity:1;background:var(--micrio-color-hover,var(--micrio-color));transform:translate(-50%,-50%)}
@media(hover:hover){micrio-gallery ul.dense .tick.hover{opacity:.9;transform:translate(-50%,-50%)}}
micrio-gallery .hover-label{position:absolute;bottom:calc(100% + 6px);transform:translateX(-50%);padding:2px 8px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.4;color:var(--micrio-color);background:var(--micrio-popover-background);backdrop-filter:var(--micrio-background-filter);border-radius:999px;box-shadow:var(--micrio-button-shadow);pointer-events:none;white-space:nowrap}
micrio-gallery .handle{position:absolute;top:50%;left:0;height:28px;min-width:28px;padding:0;box-sizing:border-box;background:var(--micrio-color);border:2px solid var(--micrio-color);border-radius:999px;cursor:ew-resize;touch-action:none;transform:translate(-50%,-50%);transition:left .15s ease,height .15s ease,min-width .15s ease,background-color .2s ease,box-shadow .2s ease;box-shadow:0 2px 8px rgba(0,0,0,.35),0 0 0 0 var(--micrio-color-hover)}
micrio-gallery .handle:hover{box-shadow:0 2px 8px rgba(0,0,0,.4),0 0 0 4px rgba(255,255,255,.12)}
micrio-gallery .handle.dragging{transition:none;box-shadow:0 2px 12px rgba(0,0,0,.5),0 0 0 6px rgba(255,255,255,.15);cursor:grabbing}
micrio-gallery .handle-label{position:absolute;bottom:calc(100% + 8px);left:0;transform:translateX(-50%);padding:3px 9px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.4;color:var(--micrio-color);background:var(--micrio-popover-background);backdrop-filter:var(--micrio-background-filter);border-radius:999px;box-shadow:var(--micrio-button-shadow);pointer-events:none;white-space:nowrap;transition:left .15s ease,transform .15s ease}
micrio-gallery .handle-label.dragging{transition:none;transform:translateX(-50%) scale(1.05)}
micrio-gallery.hidden:not(:hover) ul{transform:translate(-50%,calc(100% + var(--micrio-border-margin)));opacity:0;pointer-events:none}
@media(max-width:500px){micrio-gallery.hidden:not(:hover) ul{transform:translateY(calc(100% + var(--micrio-border-margin)))}}
micrio-gallery.hidden:not(:hover) .gallery-btn.arrow-left{transform:translate(calc(-100% - var(--micrio-border-margin)),-50%);opacity:0;pointer-events:none}
micrio-gallery.hidden:not(:hover) .gallery-btn.arrow-right{transform:translate(calc(100% + var(--micrio-border-margin)),-50%);opacity:0;pointer-events:none}
micrio-gallery.force-hidden ul,micrio-gallery.force-hidden .gallery-btn{opacity:0;pointer-events:none}
micrio-gallery.force-hidden ul{transform:translate(-50%,calc(100% + var(--micrio-border-margin)))}
micrio-gallery.force-hidden .gallery-btn.arrow-left{transform:translate(calc(-100% - var(--micrio-border-margin)),-50%)}
micrio-gallery.force-hidden .gallery-btn.arrow-right{transform:translate(calc(100% + var(--micrio-border-margin)),-50%)}
micrio-gallery .gallery-btn:disabled{opacity:0;pointer-events:none}
micrio-gallery .gallery-btn.micrio-button:hover,micrio-gallery .gallery-btn.micrio-button:focus{position:absolute!important}`;

	#props: GalleryProps = {};
	#unsubs: (() => void)[] = [];
	#currentPage = -1;
	#images: MicrioImage[] = [];
	#parentImage!: MicrioImage;
	#isStripSwipe = false;
	#_ul: HTMLElement | null = null;
	#prevBtn: MicrioElement | null = null;
	#nextBtn: MicrioElement | null = null;
	#_left = 0;
	#hoverIdx = -1;
	#dragging = false;
	#dragIsPointer = false;
	#box: DOMRect | null = null;
	#autoHide = true;
	#to: number | undefined;
	#stripDragId: number | undefined;
	#stripDragStartX = 0;
	#stripDragLastX = 0;
	#stripDragLastT = 0;
	#stripDragVelocity = 0;
	#stripDragActive = false;
	#stripDragHorizontal = false;
	#stripDragStartY = 0;
	#preloading = new Map<string, any>();
	#preloadD = 0;

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const image = micrio.$current as MicrioImage;
		if (!image) return;

		const settings = image.$settings;
		if (settings?.omni) {
			this.#renderOmni(image);
			return;
		}

		const controller = this.#props.controller;
		if (!controller) return;

		this.#renderGallery(micrio, image, controller);
	}

	setProps(props: Partial<GalleryProps>) {
		if (props.controller !== undefined) this.#props.controller = props.controller;
	}

	#getX(idx: number): number {
		if (!this.#_ul) return 0;
		const w = this.#_ul.clientWidth;
		const max = Math.max(1, this.#images.length - 1);
		return scrubPad + (idx / max) * (w - scrubPad * 2);
	}

	#pageLabel(idx: number): string {
		return String(idx + 1);
	}

	#activity = () => {
		if (this.classList.contains('hidden')) {
			this.classList.remove('hidden');
			this.#updateScrubber();
		}
		clearTimeout(this.#to);
		if (this.#autoHide) this.#to = window.setTimeout(() => {
			if (!this.classList.contains('hidden')) {
				this.classList.add('hidden');
				this.#updateScrubber();
			}
		}, 2000);
	}

	#goto(i: number, fast = false, duration = 150, force = false) {
		const images = this.#images;
		if (!images.length) return;
		const page = i = Math.round(Math.max(0, Math.min(images.length - 1, i)));
		const changed = force || page !== this.#currentPage;
		this.#currentPage = page;
		if (changed) this.#frameChanged();
		if (this.#isStripSwipe) {
			this.#stripGoto(page, fast, duration, changed);
		} else if (changed) {
			this.#parentImage.engine.setActiveImage(this.#parentImage.ptr, page, 0);
			const area = this.#images[page]?.opts?.area;
			if (area) this.#parentImage.camera.setView(area);
		}
		this.#parentImage.album!.hooked = true;
	}

	#frameChanged() {
		this.#preload(this.#currentPage);
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		micrio?.events.dispatch('gallery-show', this.#currentPage);
		if (this.#isStripSwipe) {
			this.#parentImage.album?.currentImage?.set(this.#images[this.#currentPage] as MicrioImage);
		}
		this.#updateScrubber();
	}

	// --- Strip-swipe ---

	#stripGoto(nextIdx: number, fast: boolean, duration: number, _changed: boolean) {
		const images = this.#images;
		if (!images[nextIdx]) return;
		const snapDur = duration === 0 ? 0 : (fast ? 0.175 : 0.35);
		const leaving = images[this.#currentPage > -1 && this.#currentPage !== nextIdx ? this.#currentPage : -1] as MicrioImage | undefined;
		const needsZoomOut = snapDur > 0 && leaving?.camera && !leaving.camera.isZoomedOut();
		const engine = images[0]?.engine;
		if (!engine) return;
		const startSlide = () => {
			engine.setGridTransitionDuration(snapDur);
			for (let i = 0; i < images.length; i++) {
				const child = images[i] as MicrioImage | undefined;
				if (!child?.camera) continue;
				const cur = child.opts.area ?? [0, 0, 1, 1];
				const prevSlotLeft = cur[0];
				const wasNearVisible = prevSlotLeft >= -1 && prevSlotLeft <= 1;
				const targetSlot = i - nextIdx;
				const target = horizontalSlot(targetSlot);
				const willBeVisible = Math.abs(targetSlot) <= 1;
				const needsMove = Math.abs(cur[0] - target[0]) > 1e-4 || Math.abs(cur[2] - target[2]) > 1e-4;
				const animate = snapDur > 0 && needsMove && (wasNearVisible || willBeVisible);
				child.camera.setArea(target, { direct: !animate, noDispatch: true });
			}
			// Re-set the arriving child's view to trigger tile loading at full zoom
			images[nextIdx]?.camera?.setView([0, 0, 1, 1]);
			engine.render();
		};
		if (needsZoomOut) leaving!.camera!.flyToCoverView({ duration: snapDur * 1000 * 0.6, speed: 2 })
			.then(startSlide).catch(startSlide);
		else startSlide();
	}

	#stripCanSwipe(): boolean {
		const active = this.#images[this.#currentPage] as MicrioImage | undefined;
		return !!active?.camera?.isZoomedOut();
	}

	#stripPointerDown = (e: PointerEvent) => {
		if (!this.#stripCanSwipe() || e.button !== 0 || this.#stripDragId !== undefined) return;
		this.#stripDragId = e.pointerId;
		this.#stripDragStartX = this.#stripDragLastX = e.clientX;
		this.#stripDragStartY = e.clientY;
		this.#stripDragLastT = e.timeStamp;
		this.#stripDragVelocity = 0;
		this.#stripDragActive = false;
		this.#stripDragHorizontal = false;
		window.addEventListener('pointermove', this.#stripPointerMove);
		window.addEventListener('pointerup', this.#stripPointerUp);
		window.addEventListener('pointercancel', this.#stripPointerUp);
	};

	#stripPointerMove = (e: PointerEvent) => {
		if (e.pointerId !== this.#stripDragId) return;
		const dx = e.clientX - this.#stripDragStartX;
		const dy = e.clientY - this.#stripDragStartY;
		if (!this.#stripDragActive) {
			if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
			this.#stripDragHorizontal = Math.abs(dx) > Math.abs(dy);
			if (!this.#stripDragHorizontal) { this.#stripPointerUp(e); return; }
			this.#stripDragActive = true;
			const micrio = this.inject<HTMLMicrioElement>('micrio');
			if (!micrio) return;
			micrio.setAttribute('data-panning', '');
			(micrio as any).keepRendering = true;
			micrio.canvas.element.setPointerCapture(e.pointerId);
		}
		const dt = Math.max(1, e.timeStamp - this.#stripDragLastT);
		this.#stripDragVelocity = (e.clientX - this.#stripDragLastX) / dt;
		this.#stripDragLastX = e.clientX;
		this.#stripDragLastT = e.timeStamp;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
		const w = micrio.offsetWidth || 1;
		const progress = dx / w;
		this.#applyDragProgress(progress);
	};

	#stripPointerUp = (e: PointerEvent) => {
		if (e.pointerId !== this.#stripDragId) return;
		window.removeEventListener('pointermove', this.#stripPointerMove);
		window.removeEventListener('pointerup', this.#stripPointerUp);
		window.removeEventListener('pointercancel', this.#stripPointerUp);
		const wasActive = this.#stripDragActive;
		this.#stripDragId = undefined;
		this.#stripDragActive = false;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
		micrio.removeAttribute('data-panning');
		(micrio as any).keepRendering = false;
		if (!wasActive) return;
		try { micrio.canvas.element.releasePointerCapture(e.pointerId); } catch (_) { }
		const w = micrio.offsetWidth || 1;
		const progress = (e.clientX - this.#stripDragStartX) / w;
		let target = this.#currentPage;
		if (progress < -0.3 || this.#stripDragVelocity < -0.5) target = Math.min(this.#images.length - 1, this.#currentPage + 1);
		else if (progress > 0.3 || this.#stripDragVelocity > 0.5) target = Math.max(0, this.#currentPage - 1);
		this.#goto(target);
	};

	#applyDragProgress(progress: number) {
		const images = this.#images;
		const curr = this.#currentPage;
		const atLeftEdge = curr === 0 && progress > 0;
		const atRightEdge = curr === images.length - 1 && progress < 0;
		const eased = (atLeftEdge || atRightEdge) ? Math.sign(progress) * Math.sqrt(Math.abs(progress)) * 0.3 : progress;
		const engine = images[0]?.engine;
		if (!engine) return;
		const active = images[curr] as MicrioImage | undefined;
		active?.camera?.setArea(horizontalSlot(eased), { direct: true, noDispatch: true });
		if (eased < 0 && curr < images.length - 1) {
			const next = images[curr + 1] as MicrioImage | undefined;
			next?.camera?.setArea(horizontalSlot(1 + eased), { direct: true, noDispatch: true });
		} else if (eased > 0 && curr > 0) {
			const prev = images[curr - 1] as MicrioImage | undefined;
			prev?.camera?.setArea(horizontalSlot(-1 + eased), { direct: true, noDispatch: true });
		}
		engine.render();
	}

	// --- Scrubber ---

	#scrubStart = (e: PointerEvent | TouchEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (this.#dragging || (this.#dragIsPointer = 'button' in e) && e.button !== 0 || !this.#_ul) return;
		this.#box = this.#_ul.getClientRects()[0];
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
		(micrio as any).keepRendering = this.#dragging = true;
		this.#hoverIdx = -1;
		window.addEventListener(this.#dragIsPointer ? 'pointermove' : 'touchmove', this.#scrubMove);
		window.addEventListener(this.#dragIsPointer ? 'pointerup' : 'touchend', this.#scrubStop);
		this.#scrubMove(e);
	};

	#getScrubXPercIdx(e: PointerEvent | TouchEvent): [number, number] {
		const _box = this.#box ?? this.#_ul!.getClientRects()[0];
		const clientX = 'button' in e ? e.clientX : (e as TouchEvent).touches[0].clientX;
		const perc = Math.min(1, Math.max(0, (clientX - _box.left - scrubPad) / (_box.width - scrubPad * 2)));
		const idx = Math.max(0, Math.min(this.#images.length - 1, Math.round(perc * Math.max(1, this.#images.length - 1))));
		return [perc, idx];
	}

	#scrubMove = (e: PointerEvent | TouchEvent) => {
		const [perc, idx] = this.#getScrubXPercIdx(e);
		this.#_left = scrubPad + perc * (this.#box!.width - scrubPad * 2);
		if (idx !== this.#currentPage) this.#goto(idx, true);
	};

	#scrubPointerMove = (e: PointerEvent | TouchEvent) => {
		if (!this.#dragging) this.#hoverIdx = this.#getScrubXPercIdx(e)[1];
		this.#updateScrubber();
	};

	#scrubStop = () => {
		window.removeEventListener(this.#dragIsPointer ? 'pointermove' : 'touchmove', this.#scrubMove);
		window.removeEventListener(this.#dragIsPointer ? 'pointerup' : 'touchend', this.#scrubStop);
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
		this.#dragging = (micrio as any).keepRendering = false;
		this.#goto(this.#currentPage);
	};

	// --- Preloading ---

	#preload(c: number) {
		const images = this.#images;
		if (!images.length) return;
		const d = this.#preloadD;
		const imgs: number[] = [];
		for (let x = -d; x <= d; x++) if (x) imgs.push(c + x);
		const request: any = (self as any).requestIdleCallback ?? self.requestAnimationFrame;
		const engine = images[0]?.engine;
		if (!engine) return;
		const hasArchive = !!(images[0] as any)?.$settings?.gallery?.archive;
		imgs.filter((n, i) => n >= 0 && n < images.length && imgs.indexOf(n) === i)
			.map(i => images[i])
			.filter(i => !!i && !this.#preloading.has(i.id))
			.forEach(i => this.#preloading.set(i.id, request(() =>
				engine.getTexture(i.baseTileIdx, (i as any).thumbSrc as string, false, { force: hasArchive })
			)));
	}

	// --- Keyboard ---

	#keydown = (e: KeyboardEvent) => {
		switch (e.key) {
			case 'PageUp':
			case 'ArrowLeft': this.#goto(this.#currentPage - 1, true); break;
			case 'PageDown':
			case 'ArrowRight': this.#goto(this.#currentPage + 1, true); break;
			case 'Home': this.#goto(0); break;
			case 'End': this.#goto(this.#images.length - 1); break;
			default: return;
		}
		this.#activity();
	};

	// --- Render ---

	async #renderGallery(micrio: HTMLMicrioElement, image: MicrioImage, controller: GalleryController) {
		const images: MicrioImage[] = [...controller.images];
		if (!images.length) return;

		this.#images = images;
		this.#parentImage = image;
		this.#isStripSwipe = controller.type === 'swipe';

		const idx = controller.config.startId
			? Math.max(0, images.findIndex(i => i.id === controller.config.startId))
			: 0;

		this.#preloadD = 'requestIdleCallback' in self ? 100 : 50;

		const engine = micrio.engine;
		const parent = image;

		// Initial scrubber render (before children are ready)
		this.#currentPage = idx;
		this.#buildScrubber();
		this.#updateScrubber();

		// Set up album before async work so it's available immediately
		const _self = this;
		parent.album = {
			numPages: images.length,
			get currentIndex() { return _self.#currentPage },
			info: parent.$settings.gallery,
			prev: () => _self.#goto(_self.#currentPage - 1),
			next: () => _self.#goto(_self.#currentPage + 1),
			goto: (n: number) => _self.#goto(n),
			...(_self.#isStripSwipe ? { currentImage: writable(images[idx] as MicrioImage) } : {}),
		};

		await once(parent.info);

		if (this.#isStripSwipe) {
			engine.setGridTransitionTimingFunction(Enums.Camera.TimingFunction['ease-out']);
			await Promise.allSettled(images.map(d => engine.addChild(d as MicrioImage, parent)));
			for (let i = 0; i < images.length; i++) {
				const child = images[i] as MicrioImage;
				if (!child.camera) continue;
				child.camera.setCoverLimit(false);
				child.camera.setArea(horizontalSlot(i - idx), { direct: true, noDispatch: true });
				child.camera.setView([0, 0, 1, 1]);
			}
			(images[idx] as MicrioImage)?.visible.set(true);
			this.#currentPage = idx;
			this.#frameChanged();
			parent.album!.hooked = true;
			engine.render();
		} else {
			await Promise.allSettled(images.map(d => {
				if ('state' in d && !('image' in d)) d.camera = parent.camera;
				return engine.addEmbed(d, parent, { opacity: 0, asImage: 'camera' in d });
			}));
			engine.setActiveImage(parent.ptr, idx);
			this.#goto(idx, false, 0);
		}

		// Auto-hide after a moment
		this.#activity();

		// Strip-swipe pointer events on the canvas element
		if (this.#isStripSwipe && images.length > 1) {
			const onDown = this.#stripPointerDown;
			micrio.canvas.element.addEventListener('pointerdown', onDown);
			this.#unsubs.push(() => micrio.canvas.element.removeEventListener('pointerdown', onDown));
		}

		// Auto-hide listeners
		const unhookActivity = () => {
			micrio.canvas.element.removeEventListener('pointermove', this.#activity);
			micrio.canvas.element.removeEventListener('pointerdown', this.#activity);
		};
		if (this.#autoHide) {
			micrio.canvas.element.addEventListener('pointermove', this.#activity);
			micrio.canvas.element.addEventListener('pointerdown', this.#activity);
			this.#activity();
		}
		this.#unsubs.push(unhookActivity);

		// Keyboard
		window.addEventListener('keydown', this.#keydown);
		this.#unsubs.push(() => window.removeEventListener('keydown', this.#keydown));

		// Subscriptions — force-hidden on popup/tour
		this.#unsubs.push(micrio.state.popup.subscribe(() => this.#updateScrubber()));
		this.#unsubs.push(micrio.state.tour.subscribe(() => this.#updateScrubber()));
	}

	#buildScrubber() {
		if (!this.#images.length || this.querySelector('ul')) return;

		const images = this.#images;
		const total = images.length;
		const $i18n = get(i18n);
		const dense = total > 24;
		const tickStep = dense ? Math.max(1, Math.ceil(total / 24)) : 1;
		const curr = this.#currentPage;

		// Prev button
		this.#prevBtn = document.createElement('micrio-button') as MicrioElement;
		this.#prevBtn.setProps({
			type: 'arrow-left', title: $i18n.galleryPrev, className: 'gallery-btn',
			disabled: curr <= 0,
			onclick: () => this.#goto(this.#currentPage - 1)
		});
		this.appendChild(this.#prevBtn);

		// Scrubber bar
		const ul = document.createElement('ul');
		ul.className = dense ? 'dense' : '';
		this.#_ul = ul;

		// Track
		const track = document.createElement('span');
		track.className = 'track';
		const trackFill = document.createElement('span');
		trackFill.className = 'track-fill';
		track.appendChild(trackFill);
		ul.appendChild(track);

		// Ticks
		const ticks = document.createElement('span');
		ticks.className = 'ticks';
		for (let i = 0; i < total; i++) {
			if (dense && i % tickStep !== 0 && i !== total - 1) continue;
			const tick = document.createElement('span');
			tick.className = 'tick' + (dense && i % (tickStep * 5) === 0 ? ' major' : '');
			tick.style.left = `${total > 1 ? (i / (total - 1)) * 100 : 50}%`;
			ticks.appendChild(tick);
		}
		ul.appendChild(ticks);

		// Handle
		const handle = document.createElement('button');
		handle.className = 'handle';
		handle.role = 'slider';
		handle.tabIndex = 0;
		handle.setAttribute('aria-label', 'Gallery position');
		handle.setAttribute('aria-valuemin', '1');
		handle.setAttribute('aria-valuemax', String(total));
		ul.appendChild(handle);

		// Handle label
		const hl2 = document.createElement('span');
		hl2.className = 'handle-label';
		ul.appendChild(hl2);

		// Scrubber events
		ul.addEventListener('pointerdown', this.#scrubStart);
		ul.addEventListener('touchstart', this.#scrubStart, { passive: false });
		ul.addEventListener('pointermove', this.#scrubPointerMove);
		ul.addEventListener('pointerleave', () => { this.#hoverIdx = -1; this.#updateScrubber(); });

		this.appendChild(ul);

		// Next button
		this.#nextBtn = document.createElement('micrio-button') as MicrioElement;
		this.#nextBtn.setProps({
			type: 'arrow-right', title: $i18n.galleryNext, className: 'gallery-btn',
			disabled: curr >= total - 1,
			onclick: () => this.#goto(this.#currentPage + 1)
		});
		this.appendChild(this.#nextBtn);
	}

	#updateScrubber() {
		const images = this.#images;
		const total = images.length;
		if (!total) return;
		const curr = this.#currentPage;
		const dense = total > 24;
		const tickStep = dense ? Math.max(1, Math.ceil(total / 24)) : 1;
		const fillPct = total > 1 ? (curr / (total - 1)) * 100 : 0;
		const left = this.#_ul && !this.#dragging ? this.#getX(curr) : this.#_left;

		// Track fill
		const trackFill = this.querySelector('.track-fill') as HTMLElement;
		if (trackFill) trackFill.style.width = `${fillPct}%`;

		// Ticks active/hover state
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

		// Handle
		const handle = this.querySelector('.handle') as HTMLElement;
		if (handle) {
			handle.style.left = `${left}px`;
			handle.classList.toggle('dragging', this.#dragging);
			handle.setAttribute('aria-valuenow', String(curr + 1));
		}

		// Handle label
		const hl = this.querySelector('.handle-label') as HTMLElement;
		if (hl) {
			hl.style.left = `${left}px`;
			hl.classList.toggle('dragging', this.#dragging);
			hl.textContent = this.#pageLabel(curr) + (dense ? ` / ${total}` : '');
		}

		// Hover label
		let hoverLabel = this.querySelector('.hover-label') as HTMLElement;
		if (this.#hoverIdx >= 0 && this.#hoverIdx !== curr && !this.#dragging) {
			if (!hoverLabel) {
				hoverLabel = document.createElement('span');
				hoverLabel.className = 'hover-label';
				this.querySelector('ul')?.appendChild(hoverLabel);
			}
			hoverLabel.style.left = `${total > 1 ? (this.#hoverIdx / (total - 1)) * 100 : 50}%`;
			hoverLabel.textContent = this.#pageLabel(this.#hoverIdx);
		} else {
			hoverLabel?.remove();
		}

		// Prev/next disabled state
		if (this.#prevBtn) this.#prevBtn.setProps({ disabled: curr <= 0 });
		if (this.#nextBtn) this.#nextBtn.setProps({ disabled: curr >= total - 1 });

		// Force-hidden when popup/tour is open
		const hasPopup = this.inject<HTMLMicrioElement>('micrio')?.state.popup ? get(this.inject<HTMLMicrioElement>('micrio')!.state.popup) : undefined;
		const hasTour = this.inject<HTMLMicrioElement>('micrio')?.state.tour ? get(this.inject<HTMLMicrioElement>('micrio')!.state.tour) : undefined;
		this.classList.toggle('force-hidden', !!hasPopup || !!hasTour);
	}

	#renderOmni(image: MicrioImage) {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
		const settings = image.$settings;
		const omni = settings.omni;
		if (!omni) return;
		const engine = micrio.engine;
		const info = image.$info;
		if (!info) return;
		const totalFrames = omni.frames;
		const numLayers = omni.layers?.length ?? 1;
		const pagesPerLayer = totalFrames / numLayers;

		// Ensure image is registered with the engine
		if (image.ptr < 0) {
			once(image.info).then(() => {
				if (image.ptr >= 0) this.#initOmniFrames(image, engine, info, totalFrames, pagesPerLayer);
			});
			return;
		}

		this.#initOmniFrames(image, engine, info, totalFrames, pagesPerLayer);
	}

	#initOmniFrames(image: MicrioImage, engine: any, info: any, totalFrames: number, pagesPerLayer: number) {
		const micrio = this.inject<HTMLMicrioElement>('micrio')!;

		const hasArchive = !!image.$settings.gallery?.archive;
		const preloadD = 'requestIdleCallback' in self
			? Math.max(36, Math.floor(totalFrames / 8) * 2)
			: 50;
		const preloading = this.#preloading;
		const request: any = (self as any).requestIdleCallback ?? self.requestAnimationFrame;
		const preload = (c: number) => {
			for (let x = -preloadD; x <= preloadD; x++) {
				if (!x) continue;
				let rX = c + x;
				while (rX < 0) rX += totalFrames;
				while (rX >= totalFrames) rX -= totalFrames;
				if (!preloading.has(frames[rX].id)) {
					preloading.set(frames[rX].id, request(() =>
						engine.getTexture(frames[rX].baseTileIdx, frames[rX].thumbSrc, false, { force: hasArchive })
					));
				}
			}
		};

		// Register all frames with the engine
		const frames: any[] = [];
		for (let j = 0; j < totalFrames; j++) {
			const frame: any = {
				id: info.id + '/' + j,
				image,
				visible: writable(false),
				frame: j,
				opts: { area: [0, 0, 1, 1] },
				ptr: -1,
				baseTileIdx: -1,
				thumbSrc: image.getTileSrc(image.levels, 0, 0, j),
			};
			engine.addEmbed(frame, image, { opacity: 0, asImage: false });
			frames.push(frame);
		}

		// Show the first frame
		engine.setActiveImage(image.ptr, 0);
		engine.render();

		// Create the dial before the swiper so gotoFn can reference it
		const dial = document.createElement('micrio-dial') as MicrioElement;
		dial.setProps({
			currentRotation: 0, frames: pagesPerLayer, degrees: true,
			onturn: (frame: number) => {
				const idx = Math.round(frame) % pagesPerLayer;
				image.swiper?.goto(idx);
			}
		});
		this.appendChild(dial);

		// Navigation function shared by swiper and dial
		const gotoFn = (idx: number) => {
			while (idx < 0) idx += pagesPerLayer;
			idx %= pagesPerLayer;
			engine.setActiveImage(image.ptr, idx);
			dial.setProps({ currentRotation: (idx / pagesPerLayer) * 360 });
			preload(idx);
			engine.render();
		};

		// Create swiper for gesture-based rotation
		image.swiper = new GallerySwiper(micrio, pagesPerLayer, gotoFn, { continuous: true });

		// Preload initial frames
		preload(0);

		// Sync dial rotation when layer changes
		this.#unsubs.push(image.state.layer.subscribe((idx: number) => {
			dial.setProps({ currentRotation: (idx / pagesPerLayer) * 360 });
		}));

		// Omni layer menu: inject a layer-switcher into the image data's pages
		const omniCfg = image.$settings.omni;
		const omniNumLayers = omniCfg?.layers?.length ?? 1;
		if (omniNumLayers > 1) {
			const layerNames = omniCfg!.layers!.map((l: any, idx: number) => ({
				i18n: Object.fromEntries(Object.entries(l.i18n || {}).map(([lang, name]: [string, any]) => [lang, { title: name ?? 'Layer ' + (idx + 1) }]))
			}));
			// Fill in missing language translations with default names
			const langs = Object.keys(info.revision ?? {}) as string[];
			if (!langs.length) {
				const ml = get(micrio._lang);
				if (ml) langs.push(ml);
			}
			if (langs.length) {
				for (const lang of langs) {
					for (let i = 0; i < layerNames.length; i++) {
						if (!layerNames[i].i18n[lang]) {
							layerNames[i].i18n[lang] = { title: 'Layer ' + (i + 1) };
						}
					}
				}
			}
			const printLayerMenu = () => {
				const currentLayer = get(image.state.layer);
				image.data.update((d: any) => {
					if (!d) d = {};
					if (!d.pages) d.pages = [];
					// Remove stale _omni-layers entry so the page ID changes
					// and the toolbar's checkRenderKey sees a new key
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
			this.#unsubs.push(image.state.layer.subscribe(printLayerMenu));
		}
	}

	onDestroy() {
		// Destroy GallerySwiper if we set it on the image
		const image = this.inject<HTMLMicrioElement>('micrio')?.$current;
		if (image?.swiper) {
			image.swiper.destroy();
			image.swiper = undefined;
		}
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioGallery.tag, MicrioGallery);
