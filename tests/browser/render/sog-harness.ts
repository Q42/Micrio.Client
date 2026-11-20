import { vi, type Mock } from 'vitest'

import { writable, get, type Writable } from '$core/store'
import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'

/**
 * The fake host, image and viewer the SOG suites drive.
 *
 * `SogRenderer` only touches a small, documented slice of `HTMLMicrioElement` and
 * `MicrioImage`: the dataset attributes, the placeholder `<canvas>`, the engine flags,
 * the WebGL mask hooks, the UI progress setter and the image's `view`/`omniRotation`
 * stores. Faking that slice keeps every SOG test off Chromium's WebGL context budget
 * (there is no tile renderer and no PlayCanvas viewer here), which is what lets the
 * suite drive the download, hybrid-mask and settle paths deterministically.
 *
 * The stores are the real `writable`s, so `#onCameraChange` runs exactly as it does in
 * production. `omni.setRotation` mimics `OmniUI`'s seamless mode: it normalizes the
 * degrees, writes them to the store and keeps `_activeImageIdx` in sync.
 */

export type SogInfo = Models.ImageInfo.SogInfo
export type SogView = Models.Camera.View

/** The SOG viewer handle shape `SogRenderer` calls. */
export interface SogViewer {
	canvas: HTMLCanvasElement
	setView: Mock
	resize: Mock
	requestRender: Mock
	dispose: Mock
	camera?: { clearColor: { r: number; g: number; b: number; a: number } }
	backend?: string
	hdr?: boolean
}

/** The options `SogRenderer` passes to the viewer factory. */
export interface SogFactoryOptions {
	canvas: HTMLCanvasElement
	url: string
	filename?: string
	startFrameFraction?: number
}

export interface SogSceneOptions {
	/** Dataset keys, e.g. `preferSog: 'm'` or `sog: ''`. */
	attrs?: Record<string, string>
	/** Make the scene's engine report hybrid mode. */
	hybrid?: boolean
	/** Merged over the default omni settings, or `null` for an image without omni. */
	omni?: Partial<Models.ImageInfo.OmniSettings> | null
	id?: string
	/** Overrides the image's data path (the host SOG files are loaded from). */
	dataPath?: string
	/** Overrides the image info path, the data-path fallback. */
	infoPath?: string
	/** Leave the photo canvas detached, so the overlay falls back to `micrio.append`. */
	photoDetached?: boolean
}

export interface SogScene {
	host: HTMLElement
	micrio: HTMLMicrioElement
	image: MicrioImage
	photo: HTMLCanvasElement
	view: Writable<SogView | undefined>
	rotation: Writable<number | undefined>
	canvas: { images: { _gotBase: number }[]; layer: number; _activeImageIdx: number }
	webgl: { _clear: Mock; _setMask: Mock; _setMaskEnabled: Mock }
	engine: { _sogHybrid: boolean; _sogSettled: boolean; render: Mock }
	ui: { _setProps: Mock }
	events: { $enabled: boolean; unhook: Mock; hook: Mock; _el: HTMLCanvasElement }
	adopt: Mock
	setRotation: Mock
}

/** A SOG capture entry with sane defaults. */
export const sogInfo = (name: string, fileSize = 1024, timestamp = 1000): SogInfo => ({
	name,
	fileSize,
	timestamp,
	numSplats: 100,
})

const DEFAULT_OMNI: Models.ImageInfo.OmniSettings = {
	frames: 36,
	startIndex: 0,
	fieldOfView: 0,
	verticalAngle: 0,
	distance: 0,
	offsetX: 0,
	sog: [sogInfo('l')],
}

/** Builds the fake element/image pair a `SogRenderer` can start on. */
export function makeSogScene(options: SogSceneOptions = {}): SogScene {
	const host = document.createElement('div')
	document.body.append(host)
	for (const [key, value] of Object.entries(options.attrs ?? {})) {
		host.dataset[key] = value
	}

	const photo = document.createElement('canvas')
	photo.width = 120
	photo.height = 60
	// The detached case exercises the overlay's `micrio.append` fallback.
	if (!options.photoDetached) {
		host.append(photo)
	}

	const omni =
		options.omni === null ? undefined : ({ ...DEFAULT_OMNI, ...options.omni } as Models.ImageInfo.OmniSettings)

	const view = writable<SogView | undefined>()
	const rotation = writable<number | undefined>(0)
	const frames = Math.max(1, omni?.frames ?? 1)
	const canvas = {
		images: Array.from({ length: frames }, () => ({ _gotBase: 1 })),
		layer: 0,
		_activeImageIdx: 0,
	}

	const clear = vi.fn()
	const setMask = vi.fn()
	const setMaskEnabled = vi.fn()
	const render = vi.fn()
	const uiProps = vi.fn()
	const unhook = vi.fn()
	const hook = vi.fn()
	const adopt = vi.fn()

	const events = { $enabled: true, unhook, hook, _el: photo }
	const engine = { _sogHybrid: Boolean(options.hybrid), _sogSettled: true, render }
	const webgl = { _clear: clear, _setMask: setMask, _setMaskEnabled: setMaskEnabled }

	// Mirrors `OmniUI`'s seamless `setRotation`: normalize, publish, sync the frame index.
	const setRotation = vi.fn((degrees: number) => {
		const normalized = ((degrees % 360) + 360) % 360
		rotation.set(normalized)
		canvas._activeImageIdx = Math.round((normalized / 360) * frames) % frames
	})

	const image = {
		id: options.id ?? 'abc123',
		_dataPath: options.dataPath ?? 'https://data.example/assets/',
		$info: { path: options.infoPath ?? 'https://tiles.example/' },
		$settings: { omni },
		state: {
			view,
			omniRotation: rotation,
			get $view(): SogView | undefined {
				return get(view)
			},
			get $omniRotation(): number | undefined {
				return get(rotation)
			},
		},
		canvas,
		omni: { setRotation },
	} as unknown as MicrioImage

	const micrio = host as unknown as HTMLMicrioElement
	const mutable = micrio as unknown as Record<string, unknown>
	mutable.canvas = { element: photo, _adoptElement: adopt }
	mutable._engine = engine
	mutable._webgl = webgl
	mutable._ui = { _setProps: uiProps }
	mutable.events = events

	return {
		host,
		micrio,
		image,
		photo,
		view,
		rotation,
		canvas,
		webgl,
		engine,
		ui: { _setProps: uiProps },
		events,
		adopt,
		setRotation,
	}
}

/** A recording SOG viewer; `overrides` can make it return another canvas or backend. */
export function makeViewer(canvas: HTMLCanvasElement, overrides: Partial<SogViewer> = {}): SogViewer {
	return {
		canvas,
		setView: vi.fn(),
		resize: vi.fn(),
		requestRender: vi.fn(),
		dispose: vi.fn(),
		camera: { clearColor: { r: 1, g: 1, b: 1, a: 1 } },
		...overrides,
	}
}

export interface InstalledFactory {
	calls: SogFactoryOptions[]
	viewers: SogViewer[]
}

/** Installs `globalThis.createMicrioSogViewer`, recording its calls and viewers. */
export function installViewerFactory(
	make: (options: SogFactoryOptions) => SogViewer | Promise<SogViewer> = (options) => makeViewer(options.canvas),
): InstalledFactory {
	const calls: SogFactoryOptions[] = []
	const viewers: SogViewer[] = []
	globalThis.createMicrioSogViewer = (async (options: SogFactoryOptions) => {
		calls.push(options)
		const viewer = await make(options)
		viewers.push(viewer)
		return viewer
	}) as NonNullable<typeof globalThis.createMicrioSogViewer>
	return { calls, viewers }
}

/** The URL a `fetch` input stringifies to, without the nested ternary. */
function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === 'string') {
		return input
	}
	if (input instanceof URL) {
		return input.href
	}
	const { url } = input
	return url
}

/** Replaces `fetch` with `respond` and returns the recording mock. */
export function stubFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): Mock {
	const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => respond(requestUrl(input), init))
	globalThis.fetch = fetchMock as unknown as typeof fetch
	return fetchMock
}

/** A successful binary response, with a `content-length` header unless `total` is 0. */
export function binaryResponse(bytes: number[] = [1, 2, 3, 4], total = bytes.length): Response {
	return new Response(new Uint8Array(bytes), {
		status: 200,
		headers: total > 0 ? { 'content-length': String(total) } : {},
	})
}

/** A successful response without a body stream, for the `arrayBuffer` fallback. */
export function arrayBufferResponse(bytes = new Uint8Array([1, 2, 3])): Response {
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		body: null,
		arrayBuffer: () => Promise.resolve(bytes.buffer),
	} as unknown as Response
}

/** Paints opaque content into a canvas, so the SOG mask probe sees alpha. */
export function paint(canvas: HTMLCanvasElement): void {
	const context = canvas.getContext('2d')
	if (!context) {
		throw new Error('no 2d context for the fake overlay')
	}
	context.clearRect(0, 0, canvas.width, canvas.height)
	context.fillStyle = 'rgba(255, 255, 255, 1)'
	context.fillRect(0, 0, canvas.width, canvas.height)
}

/** Resolves on the next animation frame. */
export const nextFrame = (): Promise<void> =>
	new Promise((resolve) => {
		requestAnimationFrame(() => {
			resolve()
		})
	})

/** The progress values a scene's UI was asked to show. */
export function progressValues(scene: SogScene): number[] {
	return scene.ui._setProps.mock.calls.map(([props]) => (props as { loadingProgress: number }).loadingProgress)
}
