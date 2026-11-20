import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'

import { Frame } from '$core/frame'
import { easeInOut } from '$render/easing'
import { createElement } from '$utils/dom'

/** Released Micrio SOG viewer bundle; keep in sync with Micrio.360Splats/package.json. */
const SOG_VIEWER_BASE = 'https://r2.micr.io/'
const SOG_VIEWER_VERSION = '0.1.1'
const SOG_VIEWER_URL = `${SOG_VIEWER_BASE}micrio-pc-sog-${SOG_VIEWER_VERSION}.min.js`

/** A PlayCanvas colour, only used to make the viewer's clear transparent. */
interface ViewerColour {
	r: number
	g: number
	b: number
	a: number
}

/** The subset of the SOG viewer handle this integration calls. */
interface MicrioSogViewer {
	canvas: HTMLCanvasElement
	setView: (view: {
		degrees?: number
		view?: Models.Camera.View
		yaw?: number
		pitch?: number
		distance?: number
		target?: { x: number; y: number; z: number }
	}) => void
	resize: () => void
	requestRender?: () => void
	dispose: () => void
	/** Set by the viewer; the hybrid layer needs it transparent. */
	camera?: { clearColor?: ViewerColour }
	/** `"webgpu"` or `"webgl2"`. The WebGPU path renders an opaque canvas. */
	backend?: string
	hdr?: boolean
}

type CreateMicrioSogViewer = (options: {
	canvas: HTMLCanvasElement
	url: string
	filename?: string
	startFrameFraction?: number
}) => Promise<MicrioSogViewer>

declare global {
	/** Set by the page (or loaded below) from the PlayCanvas SOG bundle. */
	var createMicrioSogViewer: CreateMicrioSogViewer | undefined
}

/**
 * True when the element forces the SOG-only renderer via `data-prefer-sog`
 * (`data-prefer-splats` is the older spelling and keeps working).
 */
const prefersSog = (micrio: HTMLMicrioElement): boolean =>
	Object.hasOwn(micrio.dataset, 'preferSog') || Object.hasOwn(micrio.dataset, 'preferSplats')

/** True when `data-sog` asks for the hybrid overlay. */
const wantsSogHybrid = (micrio: HTMLMicrioElement): boolean => Object.hasOwn(micrio.dataset, 'sog')

/**
 * The `.sog` name requested by the active attribute, or `''` when no name was
 * given. Both the SOG-only and the hybrid attributes use the same value.
 */
const preferredSogName = (micrio: HTMLMicrioElement): string => {
	let value = micrio.dataset.sog
	if (Object.hasOwn(micrio.dataset, 'preferSog')) {
		value = micrio.dataset.preferSog
	} else if (Object.hasOwn(micrio.dataset, 'preferSplats')) {
		value = micrio.dataset.preferSplats
	}
	return value?.trim() ?? ''
}

/** Fallback capture size limit: without a usable name, the first capture under this wins. */
const MAX_FALLBACK_SOG_BYTES = 20 * 1024 * 1024

/** The largest SOG capture, used only when no capture is under the fallback limit. */
const biggestSog = (sog: Models.ImageInfo.SogInfo[] | undefined): Models.ImageInfo.SogInfo | undefined => {
	let best: Models.ImageInfo.SogInfo | undefined
	for (const entry of sog ?? []) {
		if (!best || entry.fileSize > best.fileSize) {
			best = entry
		}
	}
	return best
}

/**
 * The SOG capture to load. `data-prefer-sog="<name>"` or `data-sog="<name>"`
 * selects the entry with that name; otherwise the first entry smaller than
 * 20 MB is used, and only when every capture is larger does the largest win.
 */
const pickSog = (
	micrio: HTMLMicrioElement,
	sog: Models.ImageInfo.SogInfo[] | undefined,
): Models.ImageInfo.SogInfo | undefined => {
	const entries = sog ?? []
	const name = preferredSogName(micrio)
	return (
		(name ? entries.find((entry) => entry.name === name) : undefined) ??
		entries.find((entry) => entry.fileSize < MAX_FALLBACK_SOG_BYTES) ??
		biggestSog(entries)
	)
}

/** The image's data host; SOG files live beside the image data, not the tile host. */
const imageBaseHost = (image: MicrioImage): string => {
	const base = image._dataPath || image.$info.path
	try {
		return new URL(base, location.href).origin
	} catch {
		return base.replace(/\/+$/, '')
	}
}

/** The release URI of a SOG capture: <image base host>/<id>/sog/<name>-<timestamp>.sog.bin. */
const sogUrl = (image: MicrioImage, sog: Models.ImageInfo.SogInfo): string =>
	`${imageBaseHost(image)}/${encodeURIComponent(image.id)}/sog/${encodeURIComponent(sog.name)}-${sog.timestamp}.sog.bin`

/** True when this bundle should use the SOG viewer, alone or as the hybrid overlay. */
export const isSogBundle = (micrio: HTMLMicrioElement, bundle: Models.ImageBundle.BundleImage): boolean => {
	if (!prefersSog(micrio) && !wantsSogHybrid(micrio)) {
		return false
	}
	return Boolean(bundle.settings?.omni?.sog?.length)
}

/**
 * True when `data-sog` asks for the overlay: the SOG is drawn on a transparent
 * canvas above the normal photo renderer, whose background is cut away with the
 * SOG's alpha. Navigation runs on the SOG; when it stops, the rotation snaps to
 * the nearest photographed frame and the SOG fades out. `data-prefer-sog` keeps
 * forcing the SOG-only renderer, so it wins when both are set.
 */
export const isSogHybrid = (micrio: HTMLMicrioElement): boolean => !prefersSog(micrio) && wantsSogHybrid(micrio)

/**
 * Resolves the PlayCanvas viewer factory. A page that already included the
 * classic bundle (`<script src="…/micrio-pc-sog-<version>.min.js">`, which
 * registers `globalThis.createMicrioSogViewer`) is used as-is; only otherwise is
 * the bundle fetched, and only when a SOG image is actually opened.
 */
let viewerLoader: Promise<CreateMicrioSogViewer | null> | undefined
const getCreateMicrioSogViewer = (): Promise<CreateMicrioSogViewer | null> => {
	if (globalThis.createMicrioSogViewer) {
		return Promise.resolve(globalThis.createMicrioSogViewer)
	}
	viewerLoader ??= new Promise<CreateMicrioSogViewer | null>((resolve) => {
		const script = document.createElement('script')
		script.src = SOG_VIEWER_URL
		script.async = true
		script.addEventListener(
			'load',
			() => {
				script.remove()
				const factory = globalThis.createMicrioSogViewer
				if (!factory) {
					console.error('[Micrio] The SOG viewer loaded without registering createMicrioSogViewer.')
				}
				resolve(factory ?? null)
			},
			{ once: true },
		)
		script.addEventListener(
			'error',
			() => {
				script.remove()
				viewerLoader = undefined
				console.error('[Micrio] Could not load the SOG viewer:', SOG_VIEWER_URL)
				resolve(null)
			},
			{ once: true },
		)
		document.head.append(script)
	})
	return viewerLoader
}

/** How long the view must be still before the overlay snaps to a photograph. */
const HYBRID_IDLE_MS = 220
/** Duration of the auto-rotation to the nearest photographed frame. */
const HYBRID_SNAP_MS = 260
/** Crossfade from the SOG to the photograph. */
const HYBRID_FADE_MS = 320
/** Longest wait for the photograph's base tile before retrying. */
const HYBRID_PHOTO_WAIT_MS = 2500
/** Mask resolution relative to the SOG canvas. */
const MASK_SCALE = 0.5

/**
 * Runs the PlayCanvas SOG viewer on the Micrio `<canvas>` for `data-prefer-sog`
 * images (`="<name>"` picks that `.sog` entry). Micrio's tile canvas and camera
 * stay alive: they own gestures, zoom limits, animations and the omni dial exactly
 * as in the tile viewer, while the tile renderer itself never initializes WebGL
 * or loads textures. Every view the camera publishes is mirrored into the SOG
 * viewer's absolute degrees + view API.
 *
 * With `data-sog`, the viewer runs on a transparent overlay canvas above
 * the normal tile renderer instead. The SOG's alpha is copied into the photo
 * shader as a mask, so the photograph loses its background, and the two layers
 * crossfade: SOG while moving, photograph once the rotation has snapped to a
 * photographed frame.
 * @internal
 */
export class SogRenderer {
	#micrio: HTMLMicrioElement
	#image: MicrioImage | undefined
	#viewer: MicrioSogViewer | undefined
	#unsubscribers: (() => void)[] = []
	#controller: AbortController | undefined
	#gen = 0

	/** True when the SOG is a transparent overlay above the photograph. */
	#hybrid = false
	/** The overlay canvas; also the mask source. */
	#overlay: HTMLCanvasElement | undefined
	/** Downscaled copy of the overlay, uploaded as the photo mask. */
	#scratch: HTMLCanvasElement | undefined
	/** Tiny copy used to detect a blank (not yet drawn) SOG canvas. */
	#probe: HTMLCanvasElement | undefined
	#captureRaf = 0
	#captureRetries = 0
	#captureTimer = 0
	/** Set once the first non-empty mask has been uploaded. */
	#maskReady = false
	/** The SOG is faded out and the photograph shows. */
	#settled = false
	/** The photo buffer was cleared because its frame no longer matches the SOG. */
	#photoCleared = false
	/** The camera is snapping to the nearest frame or fading out. */
	#settling = false
	#settleGen = 0
	#idleTimer = 0
	#snapRaf: ((time: number) => void) | undefined

	/** Bound resize handler, so the same reference can be removed. */
	#onResize = () => {
		this.#viewer?.resize()
		this.#apply()
	}

	/** Pointer/wheel input cancels a settle in progress and hands back to the SOG. */
	#onInput = () => {
		if (!this.#hybrid || !this.#settling) {
			return
		}
		this.#cancelSettle()
		this.#touch()
	}

	constructor(micrio: HTMLMicrioElement) {
		this.#micrio = micrio
	}

	/** Loads the SOG and mirrors the Micrio camera into it. */
	async start(image: MicrioImage): Promise<void> {
		this.dispose()
		const gen = ++this.#gen
		const controller = new AbortController()
		this.#controller = controller
		this.#image = image
		this.#hybrid = this.#micrio._engine._sogHybrid

		const { omni } = image.$settings
		const sog = pickSog(this.#micrio, omni?.sog)
		if (!omni || !sog) {
			this.#setProgress(1)
			return
		}
		const frames = Math.max(1, omni.frames / Math.max(1, omni.layers?.length ?? 1))
		let startIndex = omni.startIndex ?? 0
		while (startIndex < 0) {
			startIndex += frames
		}
		startIndex %= frames

		this.#setProgress(0.02)
		const createMicrioSogViewer = await getCreateMicrioSogViewer()
		if (gen !== this.#gen) {
			return
		}
		if (!createMicrioSogViewer) {
			console.warn('[Micrio] The SOG viewer is not available; add the Micrio SOG viewer script or let Micrio load it.')
			this.#setProgress(1)
			return
		}

		const canvas = this.#hybrid ? this.#createOverlay() : this.#micrio.canvas.element
		const remoteUrl = sogUrl(image, sog)
		const filename = `${image.id}/${sog.name}-${sog.timestamp}.sog`
		this.#setProgress(0.05)

		let objectUrl: string | undefined
		let viewer: MicrioSogViewer
		try {
			// Pre-fetch so the standard progress circle shows real byte progress,
			// like the omni archive's `.bin` download, then hand the viewer a blob.
			const blob = await this.#download(remoteUrl, controller.signal, gen)
			if (gen !== this.#gen) {
				return
			}
			objectUrl = URL.createObjectURL(blob)
			viewer = await this.#createViewer(createMicrioSogViewer, {
				canvas,
				url: objectUrl,
				filename,
				startFrameFraction: startIndex / frames,
			})
		} catch (error) {
			if (gen === this.#gen) {
				console.error('[Micrio] Could not load the SOG:', error)
				this.#setProgress(1)
				this.#dropOverlay()
			}
			return
		} finally {
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl)
			}
		}
		if (gen !== this.#gen) {
			viewer.dispose()
			return
		}
		this.#setProgress(1)

		if (this.#hybrid) {
			// The alpha channel is what cuts the photograph out, so a backend
			// without one cannot be the overlay. The viewer also replaces the
			// canvas when WebGPU falls back, which is handled below.
			if (viewer.hdr || viewer.backend === 'webgpu') {
				console.warn('[Micrio] The SOG overlay needs the WebGL viewer; this display uses WebGPU.')
				viewer.dispose()
				this.#dropOverlay()
				return
			}
			const clear = viewer.camera?.clearColor
			if (clear) {
				clear.r = 0
				clear.g = 0
				clear.b = 0
				clear.a = 0
			}
			if (viewer.canvas !== canvas) {
				this.#overlay = viewer.canvas
				if (!viewer.canvas.parentNode) {
					const photo = this.#micrio.canvas.element
					photo.parentNode?.insertBefore(viewer.canvas, photo.nextSibling)
				}
			}
		} else if (viewer.canvas !== canvas) {
			// The viewer replaces the canvas when WebGPU claims it and then falls back
			// to WebGL2. The page and Micrio's input hooks have to follow that.
			const { events } = this.#micrio
			const wasEnabled = events.$enabled
			events.unhook()
			this.#micrio.canvas._adoptElement(viewer.canvas)
			events._el = viewer.canvas
			if (wasEnabled) {
				events.hook()
			}
		}

		this.#viewer = viewer
		viewer.resize()
		this.#unsubscribers.push(
			image.state.view.subscribe(this.#onCameraChange),
			image.state.omniRotation.subscribe(this.#onCameraChange),
		)
		this.#micrio.addEventListener('resize', this.#onResize)
		if (this.#hybrid) {
			this.#micrio.addEventListener('pointerdown', this.#onInput, true)
			this.#micrio.addEventListener('wheel', this.#onInput, { capture: true, passive: true })
		}
		this.#apply()
	}

	/** The camera changed: wake the SOG, then mirror the view into it. */
	#onCameraChange = (): void => {
		this.#touch()
		this.#apply()
	}

	/**
	 * Creates the SOG viewer. The HDR path uses WebGPU, whose canvas has no alpha
	 * channel, so the overlay forces the WebGL2 viewer instead. The published
	 * viewer checks `navigator.gpu` synchronously before anything else, so hiding
	 * it for the call itself is enough (and is restored right after).
	 */
	#createViewer(
		create: CreateMicrioSogViewer,
		options: Parameters<CreateMicrioSogViewer>[0],
	): Promise<MicrioSogViewer> {
		if (!this.#hybrid) {
			return create(options)
		}
		const descriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu')
		Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
		try {
			// The call itself runs the viewer's backend preflight synchronously;
			// restoring the property right away is enough.
			return create(options)
		} finally {
			if (descriptor) {
				Object.defineProperty(navigator, 'gpu', descriptor)
			} else {
				Reflect.deleteProperty(navigator, 'gpu')
			}
		}
	}

	/** Creates the transparent canvas above the photograph. */
	#createOverlay(): HTMLCanvasElement {
		const overlay = createElement('canvas', { className: 'micrio micrio-sog' })
		const photo = this.#micrio.canvas.element
		if (photo.parentNode) {
			photo.parentNode.insertBefore(overlay, photo.nextSibling)
		} else {
			this.#micrio.append(overlay)
		}
		this.#overlay = overlay
		return overlay
	}

	/** Removes the overlay and its mask. */
	#dropOverlay(): void {
		this.#overlay?.remove()
		this.#overlay = undefined
	}

	/** Fades the SOG back in instantly; navigation always runs on the splat. */
	#show(): void {
		const overlay = this.#overlay
		if (!overlay) {
			return
		}
		overlay.style.transitionDuration = '0s'
		overlay.style.opacity = '1'
	}

	/** Crossfades to the photograph. */
	#hide(): void {
		const overlay = this.#overlay
		if (!overlay) {
			return
		}
		overlay.style.transitionDuration = `${HYBRID_FADE_MS}ms`
		overlay.style.opacity = '0'
	}

	/** Any camera change hands control back to the SOG and restarts the idle timer. */
	#touch(): void {
		if (!this.#hybrid || !this.#maskReady || this.#settling) {
			return
		}
		this.#settled = false
		this.#micrio._engine._sogSettled = false
		if (!this.#photoCleared) {
			// The photo buffer still shows the settled frame; the SOG is now at
			// another angle (or the stale frame is about to be displayed under
			// soft splat edges). Empty it so only the SOG is visible.
			this.#photoCleared = true
			this.#micrio._webgl._clear()
		}
		this.#show()
		this.#scheduleIdle()
	}

	#scheduleIdle(): void {
		clearTimeout(this.#idleTimer)
		this.#idleTimer = globalThis.setTimeout(this.#settle, HYBRID_IDLE_MS)
	}

	#cancelSettle(): void {
		this.#settleGen++
		if (this.#snapRaf) {
			Frame.cancel(this.#snapRaf)
			this.#snapRaf = undefined
		}
		this.#settling = false
	}

	/** Snaps the rotation to the nearest photographed frame, then fades the SOG out. */
	#settle = (): void => {
		this.#idleTimer = 0
		const image = this.#image
		const omni = image?.$settings.omni
		if (!this.#hybrid || !this.#maskReady || !image || !omni || this.#settled || this.#settling) {
			return
		}
		this.#settling = true
		const gen = ++this.#settleGen
		const frames = Math.max(1, omni.frames / Math.max(1, omni.layers?.length ?? 1))
		const current = (((image.state.$omniRotation ?? 0) % 360) + 360) % 360
		const index = Math.round((current / 360) * frames) % frames
		const target = (index / frames) * 360
		let delta = target - current
		if (delta > 180) {
			delta -= 360
		}
		if (delta < -180) {
			delta += 360
		}
		if (Math.abs(delta) < 0.01) {
			void this.#settleFinish(gen)
			return
		}
		const started = performance.now()
		const step = (time: number): void => {
			this.#snapRaf = undefined
			if (gen !== this.#settleGen) {
				return
			}
			const p = Math.min(1, Math.max(0, (time - started) / HYBRID_SNAP_MS))
			image.omni?.setRotation(current + delta * easeInOut.get(p))
			if (p < 1) {
				this.#snapRaf = step
				Frame.request(step)
			} else {
				void this.#settleFinish(gen)
			}
		}
		this.#snapRaf = step
		Frame.request(step)
	}

	/** Waits for the photographed frame, then crossfades to it. */
	async #settleFinish(gen: number): Promise<void> {
		const image = this.#image
		if (gen !== this.#settleGen || !image) {
			return
		}
		// The rotation usually lands on the frame already, but the active photo can
		// still be a stale one (a caller may set the rotation store directly, and
		// floating point never quite reaches the exact frame angle). This is
		// idempotent and also updates the active frame index.
		const { omni } = image.$settings
		if (omni) {
			const frames = Math.max(1, omni.frames / Math.max(1, omni.layers?.length ?? 1))
			const rotation = (((image.state.$omniRotation ?? 0) % 360) + 360) % 360
			image.omni?.setRotation(((Math.round((rotation / 360) * frames) % frames) / frames) * 360)
		}
		// The photo may plan and load its tiles now that the frame is final.
		const engine = this.#micrio._engine
		engine._sogSettled = true
		this.#photoCleared = false
		// Progress from an earlier frame/zoom is not this frame's plan; the next
		// draw recomputes both fields.
		engine._progress = 0
		engine._toDrawTotal = 0
		engine.render()
		const ready = await this.#photoReady(gen)
		if (gen !== this.#settleGen) {
			return
		}
		if (!ready) {
			// Keep the SOG visible and retry; a missing base tile would otherwise
			// leave a blank photograph behind the fade.
			this.#settling = false
			this.#scheduleIdle()
			return
		}
		// Let the mask of the final pose (scheduled by the last setRotation) land.
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					resolve()
				})
			})
		})
		if (gen !== this.#settleGen) {
			return
		}
		this.#settling = false
		this.#settled = true
		this.#hide()
	}

	/** Resolves once every target-layer tile of the settled photograph is ready. */
	#photoReady(gen: number): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const started = performance.now()
			const check = (): void => {
				if (gen !== this.#settleGen) {
					resolve(false)
					return
				}
				const image = this.#image
				const canvas = image?.canvas
				if (image && canvas) {
					const layers = Math.max(1, image.$settings.omni?.layers?.length ?? 1)
					const per = Math.max(1, Math.round(canvas.images.length / layers))
					const index = canvas.layer * per + canvas._activeImageIdx
					const photo = index >= 0 && index < canvas.images.length ? canvas.images[index] : undefined
					const engine = this.#micrio._engine
					// `_gotBase` is set on the first target-layer tile in hybrid mode;
					// progress reaching 1 means the whole planned target layer is
					// loaded, not just the overview.
					if (photo && photo._gotBase > 0 && engine._toDrawTotal > 0 && engine._progress >= 1) {
						resolve(true)
						return
					}
				}
				if (performance.now() - started > HYBRID_PHOTO_WAIT_MS) {
					resolve(false)
					return
				}
				setTimeout(check, 60)
			}
			// `#settleFinish` cleared the previous progress, so the first check waits
			// for the engine's next tile plan instead of reading a stale one.
			check()
		})
	}

	/** Schedules one mask copy in the frame the SOG viewer renders. */
	#scheduleCapture(): void {
		if (!this.#hybrid || this.#captureRaf) {
			return
		}
		this.#captureRaf = requestAnimationFrame(() => {
			this.#captureRaf = 0
			this.#capture()
		})
	}

	/** Copies the SOG's alpha into the tile renderer's mask texture. */
	#capture(): void {
		const overlay = this.#overlay
		if (!overlay) {
			return
		}
		const { width, height } = overlay
		if (!width || !height) {
			return
		}
		const maskWidth = Math.max(1, Math.round(width * MASK_SCALE))
		const maskHeight = Math.max(1, Math.round(height * MASK_SCALE))
		let scratch = this.#scratch
		if (!scratch) {
			scratch = this.#scratch = createElement('canvas')
		}
		if (scratch.width !== maskWidth || scratch.height !== maskHeight) {
			scratch.width = maskWidth
			scratch.height = maskHeight
		}
		const ctx = scratch.getContext('2d')
		if (!ctx) {
			return
		}
		ctx.clearRect(0, 0, maskWidth, maskHeight)
		ctx.drawImage(overlay, 0, 0, maskWidth, maskHeight)
		if (!this.#hasContent(scratch)) {
			// The viewer had not drawn yet (its first depth sort runs in a worker,
			// and the canvas is cleared whenever the browser composites). Keep the
			// previous mask and ask for another frame until the splat appears.
			if (this.#captureRetries < 48) {
				this.#captureRetries++
				this.#captureTimer = globalThis.setTimeout(() => {
					this.#captureTimer = 0
					this.#viewer?.requestRender?.()
					this.#scheduleCapture()
				}, 120)
			}
			return
		}
		this.#captureRetries = 0
		this.#micrio._webgl._setMask(scratch)
		if (!this.#maskReady) {
			this.#maskReady = true
			this.#micrio._webgl._setMaskEnabled(true)
			this.#show()
			this.#scheduleIdle()
		} else if (this.#micrio._engine._sogSettled) {
			// The capture can land after the frame that drew the photo; redraw it
			// once with the fresh mask so a settled view is never left stale.
			this.#micrio._engine.render()
		}
	}

	/** True when the copy has any alpha at all. */
	#hasContent(source: HTMLCanvasElement): boolean {
		let probe = this.#probe
		if (!probe) {
			probe = this.#probe = createElement('canvas')
			probe.width = 16
			probe.height = 16
		}
		const ctx = probe.getContext('2d', { willReadFrequently: true })
		if (!ctx) {
			return true
		}
		ctx.clearRect(0, 0, 16, 16)
		ctx.drawImage(source, 0, 0, 16, 16)
		const { data } = ctx.getImageData(0, 0, 16, 16)
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] > 2) {
				return true
			}
		}
		return false
	}

	/** Drives the same progress circle the omni `.bin` download uses. */
	#setProgress(progress: number): void {
		this.#micrio._ui?._setProps?.({
			loadingProgress: Math.max(0, Math.min(1, progress)),
		})
	}

	/** Downloads the SOG with byte progress, aborting with the renderer. */
	async #download(url: string, signal: AbortSignal, gen: number): Promise<Blob> {
		const response = await fetch(url, { signal })
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`)
		}
		const total = Number(response.headers.get('content-length')) || 0
		const reader = response.body?.getReader()
		if (!reader) {
			const buffer = await response.arrayBuffer()
			return new Blob([buffer], { type: 'application/octet-stream' })
		}
		const chunks: BlobPart[] = []
		let loaded = 0
		for (;;) {
			// oxlint-disable-next-line eslint/no-await-in-loop -- stream chunks must be read in order
			const { done, value } = await reader.read()
			if (done) {
				break
			}
			chunks.push(value)
			loaded += value.byteLength
			if (total > 0 && this.#gen === gen) {
				this.#setProgress(0.05 + (loaded / total) * 0.9)
			}
		}
		return new Blob(chunks, { type: 'application/octet-stream' })
	}

	/** Pushes Micrio's current rotation and view to the viewer. */
	#apply(): void {
		const viewer = this.#viewer
		const image = this.#image
		if (!viewer || !image) {
			return
		}
		const view = image.state.$view
		if (!view) {
			return
		}
		viewer.setView({
			degrees: image.state.$omniRotation,
			view,
		})
		if (this.#hybrid) {
			this.#scheduleCapture()
		}
	}

	/** Stops the viewer and releases the camera mirror. */
	dispose(): void {
		this.#gen++
		this.#settleGen++
		this.#controller?.abort()
		this.#controller = undefined
		clearTimeout(this.#idleTimer)
		this.#idleTimer = 0
		if (this.#snapRaf) {
			Frame.cancel(this.#snapRaf)
			this.#snapRaf = undefined
		}
		if (this.#captureRaf) {
			cancelAnimationFrame(this.#captureRaf)
			this.#captureRaf = 0
		}
		clearTimeout(this.#captureTimer)
		this.#captureTimer = 0
		this.#setProgress(1)
		for (const unsubscribe of this.#unsubscribers) {
			unsubscribe()
		}
		this.#unsubscribers = []
		this.#micrio.removeEventListener('resize', this.#onResize)
		this.#micrio.removeEventListener('pointerdown', this.#onInput, true)
		this.#micrio.removeEventListener('wheel', this.#onInput, true)
		this.#viewer?.dispose()
		this.#viewer = undefined
		this.#image = undefined
		if (this.#hybrid) {
			this.#micrio._webgl._setMaskEnabled(false)
			this.#micrio._webgl._setMask()
			this.#micrio._engine._sogSettled = true
		}
		this.#dropOverlay()
		this.#hybrid = false
		this.#maskReady = false
		this.#settled = false
		this.#photoCleared = false
		this.#settling = false
		this.#captureRetries = 0
	}
}
