import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'

import { VIEWER_BASE } from '$core/globals'

/** Micrio ids that have a local SOG capture in the 360Splats dev server. */
const SOG_IDS = new Set(['iPrQFH'])

/** The 360Splats dev server, which serves the PlayCanvas bundle and `generated/`. */
const SOG_HOST = 'http://localhost:3000'
const SOG_QUALITY = 'l'

/** The subset of the SOG viewer handle this integration calls. */
interface SogViewer {
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

type CreateSogViewer = (options: {
	canvas: HTMLCanvasElement
	url: string
	filename?: string
	startFrameFraction?: number
}) => Promise<SogViewer>

declare global {
	/** Set by the page (or loaded below) from the PlayCanvas SOG bundle. */
	var createSogViewer: CreateSogViewer | undefined
}

/** True when the element opted into SOG rendering. Both spellings are accepted. */
const prefersSog = (micrio: HTMLMicrioElement): boolean =>
	micrio.hasAttribute('prefer-sog') || Object.hasOwn(micrio.dataset, 'preferSog')

/** True when this bundle should be rendered by the SOG viewer instead of the tile engine. */
export const isSogBundle = (micrio: HTMLMicrioElement, bundle: Models.ImageBundle.BundleImage): boolean => {
	if (!prefersSog(micrio)) {
		return false
	}
	const id = (bundle.info?.id || bundle.id).replace(VIEWER_BASE, '')
	return SOG_IDS.has(id)
}

/** Resolves the PlayCanvas viewer factory from the page or the 360Splats dev server. */
let viewerFactory: Promise<CreateSogViewer | null> | undefined
const getCreateSogViewer = (): Promise<CreateSogViewer | null> => {
	if (globalThis.createSogViewer) {
		return Promise.resolve(globalThis.createSogViewer)
	}
	viewerFactory ??= import(/* @vite-ignore */ `${SOG_HOST}/playcanvas-sog.min.js`)
		.then((module: { createSogViewer?: CreateSogViewer }) => module.createSogViewer ?? null)
		.catch((error: unknown) => {
			console.error('[Micrio] Could not load the SOG viewer:', error)
			return null
		})
	return viewerFactory
}

/**
 * Runs the PlayCanvas SOG viewer on the Micrio `<canvas>` for `prefer-sog` omni
 * images. Micrio's tile canvas and camera stay alive: they own gestures, zoom
 * limits, animations and the omni dial exactly as in the tile viewer, while the
 * tile renderer itself never initializes WebGL or loads textures. Every view the
 * camera publishes is mirrored into the SOG viewer's absolute degrees + view API.
 * @internal
 */
export class SogRenderer {
	#micrio: HTMLMicrioElement
	#image: MicrioImage | undefined
	#viewer: SogViewer | undefined
	#unsubscribers: (() => void)[] = []
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
		this.#image = image

		const { omni } = image.$settings
		if (!omni) {
			return
		}
		const frames = Math.max(1, omni.frames / Math.max(1, omni.layers?.length ?? 1))
		let startIndex = omni.startIndex ?? 0
		while (startIndex < 0) {
			startIndex += frames
		}
		startIndex %= frames

		const createSogViewer = await getCreateSogViewer()
		if (gen !== this.#gen) {
			return
		}
		if (!createSogViewer) {
			console.warn('[Micrio] The SOG viewer is not loaded; include playcanvas-sog.min.js in the page.')
			return
		}

		const canvas = this.#micrio.canvas.element
		let viewer: SogViewer
		try {
			viewer = await createSogViewer({
				canvas,
				url: `${SOG_HOST}/generated/${encodeURIComponent(image.id)}/${SOG_QUALITY}.sog`,
				filename: `${image.id}/${SOG_QUALITY}.sog`,
				startFrameFraction: startIndex / frames,
			})
		} catch (error) {
			console.error('[Micrio] Could not load the SOG:', error)
			return
		}
		if (gen !== this.#gen) {
			viewer.dispose()
			return
		}

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
