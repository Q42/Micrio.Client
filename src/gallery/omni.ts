import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import type { Omni } from '$types/models/omni'
import { MicrioElement } from '$core/component'
import type { Engine } from '$render/engine'
import { easeInOut } from '$render/easing'
import { archive } from '$utils/archive'
import { createElement } from '$utils/dom'
import { icons } from '$ui/icons'
import { get, writable } from '$core/store'
import { Frame } from '$core/frame'
import '$ui/dial'

/** Callback for preloading thumbnail textures within a range around a center index. */
type PreloadRangeFn = (
	center: number,
	total: number,
	d: number,
	getTile: (idx: number) => { baseTileIdx: number; thumbSrc?: string } | undefined,
	engine: Engine,
	hasArchive: boolean,
) => void

/** Manages omni 3D object rotation UI: dial, swipe gestures, frame navigation, and layer menu. */
export class OmniUI {
	#micrio: HTMLMicrioElement
	#image: MicrioImage
	#parent: HTMLElement

	#swiperLength = 0
	#swiperOpts: { sensitivity?: number; continuous?: boolean; coverLimit?: boolean } = {}

	#startIndex: number | undefined
	#startX: number | undefined
	#hitTresh = false
	#snapTo: number[] = []
	#raf: ((time: number) => void) | undefined
	#pointers = new Map<number, boolean>()
	#isFullWidth = false
	#startedWithShift = false
	#firstTouchId: number | undefined
	#goto: (i: number) => void = () => {}
	#preloadRangeFn: PreloadRangeFn
	#cleanups: (() => void)[] = []

	/** Navigate to a specific frame index. */
	goto(i: number): void {
		this.#goto(i)
	}

	/** Active frame index currently displayed. */
	get currentIndex(): number {
		return this.#image.canvas?._activeImageIdx ?? -1
	}

	/* @internal */
	constructor(micrio: HTMLMicrioElement, image: MicrioImage, parent: HTMLElement, preloadRangeFn: PreloadRangeFn) {
		this.#micrio = micrio
		this.#image = image
		this.#parent = parent
		this.#preloadRangeFn = preloadRangeFn
	}

	/** Initialize the omni UI: create frame objects, set up dial, swipe gestures, and layer menu. */
	async setup(): Promise<void> {
		const micrio = this.#micrio
		const image = this.#image
		const parent = this.#parent

		const settings = image.$settings
		const { omni } = settings
		if (!omni) {
			return
		}

		const engine = micrio._engine
		const info = image.$info

		const totalFrames = omni.frames
		const numLayers = omni.layers?.length ?? 1
		const pagesPerLayer = totalFrames / numLayers
		// `startIndex` is an absolute frame; wrap it into the layer the way `#goto` does
		let startIdx = omni.startIndex ?? 0
		while (startIdx < 0) {
			startIdx += pagesPerLayer
		}
		startIdx %= pagesPerLayer

		if (!image._placed) {
			return
		}

		const frames: Omni.Frame[] = []
		for (let j = 0; j < totalFrames; j++) {
			const frame: Omni.Frame = {
				id: `${info.id}/${j}`,
				image,
				visible: writable(false),
				_frame: j,
				opts: { area: [0, 0, 1, 1] },
				_placed: false,
				_baseTileIdx: -1,
				thumbSrc: image._getTileSrc(image._levels, 0, 0, j),
			}
			void engine._addEmbed(frame, image, { opacity: 0, asImage: false })
			frames.push(frame)
		}

		if (Number.parseFloat(info.version) >= 5) {
			await archive
				.load(info.tileBasePath || info.path, `${info.tilesId ?? info.id}/base`, (p: number) =>
					micrio._ui?._setProps?.({ loadingProgress: p }),
				)
				.catch(() => {})
		}

		image.canvas?._setActiveImage(startIdx, 0)
		engine.render()

		const hasArchive = Boolean(image.$settings.gallery?.archive)
		const preloadD = 'requestIdleCallback' in globalThis ? Math.max(36, Math.floor(totalFrames / 8) * 2) : 50

		const preload = (c: number) => {
			this.#preloadRangeFn(
				c,
				totalFrames,
				preloadD,
				(idx) =>
					frames[idx] !== undefined
						? { baseTileIdx: frames[idx]._baseTileIdx, thumbSrc: frames[idx].thumbSrc }
						: undefined,
				engine,
				hasArchive,
			)
		}

		// `noDial` hides the only rotation control, so everything else (the swipe
		// gesture, the frame strip and the layer menu) has to work without it
		let dial: MicrioElement | undefined
		if (!omni.noDial) {
			const el = createElement('micrio-dial', {
				parent,
				setProps: {
					currentRotation: (startIdx / pagesPerLayer) * 360,
					frames: pagesPerLayer,
					degrees: Boolean(omni.showDegrees),
					onturn: (frame: number) => {
						this.goto(Math.round(frame) % pagesPerLayer)
					},
				},
			})
			if (!(el instanceof MicrioElement)) {
				return
			}
			dial = el
		}

		this.#swiperLength = pagesPerLayer
		this.#swiperOpts = { continuous: true }

		this.#goto = (idx: number) => {
			while (idx < 0) {
				idx += pagesPerLayer
			}
			idx %= pagesPerLayer
			image.canvas?._setActiveImage(idx, 0)
			dial?._setProps?.({ currentRotation: (idx / pagesPerLayer) * 360 })
			preload(idx)
			engine.render()
		}

		this.#initSwiper()
		image.omni = this
		preload(startIdx)

		this.#cleanups.push(
			image.state.layer.subscribe(() => {
				// The dial shows the *frame* within the layer, so a layer change must
				// re-sync it from the active frame — not from the layer index
				dial?._setProps?.({ currentRotation: (this.currentIndex / pagesPerLayer) * 360 })
			}),
		)

		const omniCfg = image.$settings.omni
		const omniNumLayers = omniCfg?.layers?.length ?? 1
		if (omniCfg?.layers && omniNumLayers > 1) {
			const layerNames = omniCfg.layers.map((l, i) => ({
				i18n: Object.fromEntries(
					Object.entries(l.i18n ?? {}).map(([lang, name]: [string, string?]) => [
						lang,
						{ title: name ?? `Layer ${i + 1}` },
					]),
				),
			}))
			const langs = Object.keys(info.revision ?? {})
			if (langs.length === 0) {
				const ml = get(micrio._lang)
				if (ml) {
					langs.push(ml)
				}
			}
			if (langs.length > 0) {
				for (const lang of langs) {
					for (let i = 0; i < layerNames.length; i++) {
						if (layerNames[i].i18n[lang] === undefined) {
							layerNames[i].i18n[lang] = { title: `Layer ${i + 1}` }
						}
					}
				}
			}
			const printLayerMenu = () => {
				const currentLayer = get(image.state.layer)
				image.data.update((d) => {
					if (!d) {
						d = {}
					}
					if (!d.pages) {
						d.pages = []
					}
					d.pages = d.pages.filter((p) => !p.id?.startsWith('_omni-layers'))
					d.pages.push({
						id: `_omni-layers-${currentLayer}`,
						i18n: layerNames[currentLayer].i18n,
						icon: icons.layerGroup,
						children: layerNames
							.map((title, i) => ({
								id: `omni-layer-${i}`,
								i18n: title.i18n,
								action: () => {
									image.state.layer.set(i)
									preload(get(image.state.layer) * Math.floor(totalFrames / omniNumLayers))
								},
							}))
							.filter((p) => p.id !== `omni-layer-${currentLayer}`),
					})
					return d
				})
			}
			printLayerMenu()
			this.#cleanups.push(image.state.layer.subscribe(printLayerMenu))
		}
	}

	/** Tear down the omni UI, remove listeners, and clean up resources. */
	destroy(): void {
		this.#cleanSwiper()
		for (const cleanup of this.#cleanups) {
			cleanup()
		}
		this.#cleanups = []
	}

	// ─── Swipe gesture handlers (was GallerySwiper) ──────────────

	#initSwiper() {
		const micrio = this.#micrio

		if (!this.#swiperOpts.sensitivity) {
			this.#swiperOpts.sensitivity = Number(micrio.dataset.swipeSensitivity ?? 1)
		}

		const snap = micrio.dataset.swipeSnap
		if (snap) {
			this.#snapTo = snap.split(',').map(Number)
		}

		this.#micrio.dataset.hooked = ''

		// The subscription only fires on *change*, so the flag has to be seeded from
		// the current view too — otherwise the first single-pointer drag is inert
		// until the camera view happens to change.
		const syncFullWidth = (v: Models.Camera.View | undefined): void => {
			if (this.#swiperOpts.coverLimit) {
				this.#isFullWidth = this.#image.camera.isZoomedOut()
			} else {
				this.#isFullWidth = v ? Math.round(v[3] * 1000) / 1000 >= 1 : true
			}
		}
		syncFullWidth(this.#image.state.$view)
		this.#cleanups.push(this.#image.state.view.subscribe(syncFullWidth))

		micrio._engine._noPinchPan = true
		micrio._engine._isSwipe = true

		this.#micrio.canvas.element.addEventListener('pointerdown', this.#dStart)
	}

	#cleanSwiper() {
		this.#micrio.canvas.element.removeEventListener('pointerdown', this.#dStart)
		this.#pointers.clear()
		this.#removeSwipeListeners()
		this.#micrio._engine._noPinchPan = false
		this.#micrio._engine._isSwipe = false
	}

	#removeSwipeListeners() {
		this.#micrio.removeEventListener('pointermove', this.#dMove)
		this.#micrio.removeEventListener('pointerup', this.#dStop)
	}

	#isDragging = (): boolean =>
		this.#pointers.size === 2 || ((this.#isFullWidth || this.#startedWithShift) && this.#pointers.size === 1)

	#dStart = (e: PointerEvent): void => {
		if (e.button !== 0) {
			return
		}
		this.#startedWithShift = e.shiftKey
		const newDrag = !this.#isDragging()
		this.#pointers.set(e.pointerId, true)
		if (this.#pointers.size > 2) {
			this.#pointers.clear()
			this.#removeSwipeListeners()
			return
		}

		if (newDrag) {
			this.#hitTresh = false
			this.#micrio.dataset.panning = ''
			this.#startIndex = this.currentIndex
			this.#startX = e.clientX
			this.#firstTouchId = e.pointerId
			this.#micrio.addEventListener('pointermove', this.#dMove)
			this.#micrio.addEventListener('pointerup', this.#dStop)
			this.#micrio.setPointerCapture(e.pointerId)
		}
	}

	#dMove = (e: PointerEvent): void => {
		// The gesture origin, refreshed only when a pinch turns into a swipe (below).
		let origin = this.#startX
		if (
			!this.#isDragging() ||
			e.pointerId !== this.#firstTouchId ||
			origin === undefined ||
			this.#startIndex === undefined
		) {
			return
		}

		if (!this.#hitTresh) {
			if (this.#pointers.size !== 2) {
				// A single pointer is always a swipe: keep the origin at the
				// pointerdown so the first move already turns the object
				this.#hitTresh = true
			} else if (
				Math.abs(e.clientX - origin) >
				(this.#micrio.events._pinchFactor && this.#micrio.events._pinchFactor > 1.25 ? 0.3 : 0.15) *
					this.#micrio.offsetWidth
			) {
				// A pinch that turns into a swipe is measured from where it crossed
				this.#hitTresh = true
				this.#startX = origin = e.clientX
			}
		}
		if (!this.#hitTresh) {
			return
		}

		const current = this.#micrio.$current
		if (!current) {
			return
		}
		const { camera } = current
		const scale = !this.#swiperOpts.continuous
			? 1
			: Math.max(0.1, (camera.getXY(1, 0.5)[0] - camera.getXY(0, 0.5)[0]) / this.#micrio.offsetWidth)
		const delta = Math.round(
			((e.clientX - origin) / (this.#micrio.offsetWidth * scale)) *
				this.#swiperLength *
				(this.#swiperOpts.sensitivity ?? 1),
		)
		let idx = this.#startIndex - delta

		if (this.#swiperOpts.continuous) {
			while (idx < 0) {
				idx += this.#swiperLength
			}
			while (idx > this.#swiperLength - 1) {
				idx -= this.#swiperLength
			}
		}

		idx = Math.max(0, Math.min(this.#swiperLength - 1, idx))

		if (idx !== this.currentIndex) {
			this.#goto(idx)
		}
	}

	#dStop = (e: PointerEvent): void => {
		this.#pointers.delete(e.pointerId)
		if (e.pointerId === this.#firstTouchId) {
			this.#micrio.releasePointerCapture(this.#firstTouchId)
			this.#firstTouchId = undefined
		}
		if (this.#pointers.size === 0) {
			this.#swipeEnd()
		}
	}

	#swipeEnd(): void {
		delete this.#micrio.dataset.panning
		this.#removeSwipeListeners()
		this.#hitTresh = false

		if (this.#snapTo.length > 0) {
			const snapToIndex =
				this.#snapTo[
					this.#snapTo.map((i, idx) => [idx, Math.abs(i - this.currentIndex)]).sort((a, b) => a[1] - b[1])[0][0]
				]
			if (snapToIndex !== this.currentIndex) {
				this.animateTo(snapToIndex)
			}
		}
	}

	/** Smoothly animate to a target frame index. */
	animateTo(idx: number): void {
		if (this.#raf) {
			Frame.cancel(this.#raf)
		}
		const duration = 250,
			startIdx = this.currentIndex,
			started = performance.now()
		const delta = startIdx - idx

		const frame = (time: number): void => {
			const p = Math.min(1, (time - started) / duration)
			if (p < 1) {
				this.#raf = frame
				Frame.request(frame)
			} else {
				this.#raf = undefined
			}
			const d = startIdx - Math.round(easeInOut.get(p) * delta)
			if (d !== this.currentIndex) {
				this.#goto(d)
			}
		}

		this.#raf = frame
		Frame.request(frame)
	}
}
