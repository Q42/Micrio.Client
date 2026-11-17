import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'

/** Released Micrio SOG viewer bundle; keep in sync with Micrio.360Splats/package.json. */
const SOG_VIEWER_BASE = 'https://r2.micr.io/'
const SOG_VIEWER_VERSION = '0.1.0'
const SOG_VIEWER_URL = `${SOG_VIEWER_BASE}micrio-pc-sog-${SOG_VIEWER_VERSION}.min.js`

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
	dispose: () => void
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

/** True when the element opted into SOG rendering via `data-prefer-splats`. */
const prefersSog = (micrio: HTMLMicrioElement): boolean => Object.hasOwn(micrio.dataset, 'preferSplats')

/** The largest SOG capture, used when a bundle offers multiple qualities. */
const biggestSog = (sog: Models.ImageInfo.SogInfo[] | undefined): Models.ImageInfo.SogInfo | undefined => {
	let best: Models.ImageInfo.SogInfo | undefined
	for (const entry of sog ?? []) {
		if (!best || entry.fileSize > best.fileSize) {
			best = entry
		}
	}
	return best
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

/** True when this bundle should be rendered by the SOG viewer instead of the tile engine. */
export const isSogBundle = (micrio: HTMLMicrioElement, bundle: Models.ImageBundle.BundleImage): boolean => {
	if (!prefersSog(micrio)) {
		return false
	}
	return Boolean(bundle.settings?.omni?.sog?.length)
}

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

/**
 * Runs the PlayCanvas SOG viewer on the Micrio `<canvas>` for `data-prefer-splats` omni
 * images. Micrio's tile canvas and camera stay alive: they own gestures, zoom
 * limits, animations and the omni dial exactly as in the tile viewer, while the
 * tile renderer itself never initializes WebGL or loads textures. Every view the
 * camera publishes is mirrored into the SOG viewer's absolute degrees + view API.
 * @internal
 */
export class SogRenderer {
	#micrio: HTMLMicrioElement
	#image: MicrioImage | undefined
	#viewer: MicrioSogViewer | undefined
	#unsubscribers: (() => void)[] = []
	#controller: AbortController | undefined
	#gen = 0

	/** Bound resize handler, so the same reference can be removed. */
	#onResize = () => {
		this.#viewer?.resize()
		this.#apply()
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

		const { omni } = image.$settings
		const sog = biggestSog(omni?.sog)
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

		const canvas = this.#micrio.canvas.element
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
			viewer = await createMicrioSogViewer({
				canvas,
				url: objectUrl,
				filename,
				startFrameFraction: startIndex / frames,
			})
		} catch (error) {
			if (gen === this.#gen) {
				console.error('[Micrio] Could not load the SOG:', error)
				this.#setProgress(1)
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

		this.#viewer = viewer
		// The viewer replaces the canvas when WebGPU claims it and then falls back
		// to WebGL2. The page and Micrio's input hooks have to follow that.
		if (viewer.canvas !== canvas) {
			const { events } = this.#micrio
			const wasEnabled = events.$enabled
			events.unhook()
			this.#micrio.canvas._adoptElement(viewer.canvas)
			events._el = viewer.canvas
			if (wasEnabled) {
				events.hook()
			}
		}

		viewer.resize()
		this.#unsubscribers.push(
			image.state.view.subscribe(() => {
				this.#apply()
			}),
			image.state.omniRotation.subscribe(() => {
				this.#apply()
			}),
		)
		this.#micrio.addEventListener('resize', this.#onResize)
		this.#apply()
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
	}

	/** Stops the viewer and releases the camera mirror. */
	dispose(): void {
		this.#gen++
		this.#controller?.abort()
		this.#controller = undefined
		this.#setProgress(1)
		for (const unsubscribe of this.#unsubscribers) {
			unsubscribe()
		}
		this.#unsubscribers = []
		this.#micrio.removeEventListener('resize', this.#onResize)
		this.#viewer?.dispose()
		this.#viewer = undefined
		this.#image = undefined
	}
}
