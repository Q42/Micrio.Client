import { vi, type Mock } from 'vitest'

import { writable, get, type Writable } from '$core/store'
import { Browser } from '$utils/browser'
import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import type { EventContext } from '$core/events/shared'
import type { Models } from '$types/models'

/**
 * The fake `EventContext` every `src/core/events` handler suite drives.
 *
 * The handlers only touch the `EventContext` interface (`shared.ts`), never a real
 * `<micr-io>`, so the fixture is a real wrapper `<div>` (`_micrio` role) with a real
 * `<canvas>` **child** (`_el`). That nesting is the one invariant to keep in mind:
 * the drag, wheel, pinch, pointer-pinch and gesture handlers `addEventListener` on
 * `_micrio` but reject an event whose `target` is not `_el` (or a scroll-through
 * element), so tests must dispatch on `el` and let the event bubble.
 *
 * Nothing here creates a WebGL context or opens a viewer: the camera, engine and
 * canvas facades are recording fakes, and the stores are the real `writable`s so
 * the `Events` facade can subscribe to them.
 */

/** A camera whose every interaction is recorded for assertions. */
export interface FakeCamera {
	pan: Mock
	zoom: Mock
	stop: Mock
	isZoomedOut: Mock
	_pinchStart: Mock
	_pinch: Mock
	_pinchStop: Mock
	/** The camera view the context-menu crop handler reads and restores. */
	getView: Mock
	setView: Mock
	/** The answer `isZoomedOut()` gives; tests flip it per case. */
	_zoomedOut: boolean
	/** The answer `_isZoomedIn()` gives (used by the book camera fake). */
	_zoomedIn: boolean
}

/** One fake `MicrioImage` with a fake camera and a fake kinetic tracker. */
export interface FakeImage {
	id: string
	camera: FakeCamera
	canvas: { camera: FakeCamera; _kinetic: { start: Mock; stop: Mock } }
	_is360: boolean
	_isOmni: boolean
	_noImage: boolean
	_isPassiveSecondary: boolean
	opts: { area?: number[] }
	grid?: { _getImageAt: (x: number, y: number) => FakeImage | undefined }
	error: boolean
	$settings: Partial<Models.ImageInfo.Settings>
}

/** The fake `Canvas` facade the handlers read. */
export interface FakeCanvasFacade {
	element: HTMLCanvasElement
	isMobile: Writable<boolean>
	/** Getter form, matching the real `Canvas`: the facade reads `canvas.$isMobile`. */
	$isMobile: boolean
	viewport: { width: number; height: number; ratio: number; scale: number }
	_imageCrop: Mock
	_enterCropMode: Mock
	_exitCropMode: Mock
}

/** Everything a handler/façade suite needs, plus the teardown. */
export interface EventScene {
	micrio: HTMLMicrioElement
	el: HTMLCanvasElement
	canvas: FakeCanvasFacade
	current: Writable<MicrioImage | undefined>
	visible: Writable<MicrioImage[]>
	camera: FakeCamera
	image: FakeImage | undefined
	ctx: EventContext
	dispatched: { type: string; detail?: unknown }[]
	/** `_engine.render` spy. */
	render: Mock
	/** `_engine._drawSync` spy. */
	drawSync: Mock
	/** `setPointerCapture` spy. */
	capture: Mock
	/** `releasePointerCapture` spy. */
	release: Mock
	/** Removes the scene and its elements. */
	destroy: () => void
}

/** Builds a fake camera with every seam the handlers call, returning it as a type stub. */
export function makeCamera(overrides: Record<string, unknown> = {}): FakeCamera {
	const camera: FakeCamera = {
		pan: vi.fn(),
		zoom: vi.fn(() => Promise.resolve()),
		stop: vi.fn(),
		isZoomedOut: vi.fn(() => camera._zoomedOut),
		_pinchStart: vi.fn(),
		_pinch: vi.fn(),
		_pinchStop: vi.fn(),
		getView: vi.fn(() => [0, 0, 1, 1]),
		setView: vi.fn(),
		_zoomedOut: false,
		_zoomedIn: false,
		...overrides,
	}
	return camera
}

/** Builds a fake image with the fields the handlers and `_getImage` read. */
export function makeImage(overrides: Partial<FakeImage> = {}): FakeImage {
	const camera = overrides.camera ?? makeCamera()
	return {
		id: 'test-image',
		camera,
		// The handlers reach the camera through `image.canvas.camera` for pinch and
		// through `image.camera` for drag, exactly as the real `TileCanvas` exposes it.
		canvas: { camera, _kinetic: { start: vi.fn(), stop: vi.fn() } },
		_is360: false,
		_isOmni: false,
		_noImage: false,
		_isPassiveSecondary: false,
		opts: {},
		error: false,
		$settings: {},
		...overrides,
	}
}

/** The `EventContext` shape the handlers consume, widened with the extra fields the facade adds. */
export interface SceneContext extends EventContext {
	_panning: boolean
	_pinching: boolean
	_wheeling: boolean
	_controlZoom: boolean
	_twoFingerPan: boolean
	_capturedPointerId: number | undefined
	_pinchFactor: number | undefined
	_pScale: number
	_hasUsedCtrl: boolean
	_hasTouch: boolean
}

/**
 * Builds a scene. `left`/`top` position the host away from the page origin so a
 * coordinate-space bug shows up (the wheel handler subtracts the box, `_zoom`
 * subtracts the canvas viewport's `left`/`top` again).
 */
export function makeEventScene(opts: { left?: number; top?: number; withImage?: boolean } = {}): EventScene {
	const { left = 0, top = 0, withImage = true } = opts

	const micrio = document.createElement('div')
	micrio.style.cssText = `position: fixed; left: ${left}px; top: ${top}px; width: 800px; height: 600px;`
	document.body.append(micrio)

	const el = document.createElement('canvas')
	el.style.cssText = 'width: 100%; height: 100%; display: block;'
	micrio.append(el)

	const capture = vi.fn()
	const release = vi.fn()

	const current = writable<MicrioImage | undefined>()
	const visible = writable<MicrioImage[]>([])
	const render = vi.fn()
	const drawSync = vi.fn()

	const canvas: FakeCanvasFacade = {
		element: el,
		isMobile: writable(false),
		get $isMobile() {
			return get(this.isMobile)
		},
		viewport: { width: 800, height: 600, ratio: 1, scale: 1 },
		_imageCrop: vi.fn(),
		_enterCropMode: vi.fn(),
		_exitCropMode: vi.fn(),
	}

	const camera = makeCamera()
	const image = withImage ? makeImage({ camera }) : undefined

	const dispatched: { type: string; detail?: unknown }[] = []

	// The fake host: a real EventTarget with the extra `@internal` surface the modules read.
	// The `@internal` fields are readonly on the real type, so they are assigned through a
	// mutable alias.
	const host = micrio as unknown as HTMLMicrioElement
	const mutable = host as unknown as Record<string, unknown>
	mutable.canvas = canvas
	mutable.current = current
	mutable._visible = visible
	mutable._canvases = []
	mutable._engine = { ready: true, render, _drawSync: drawSync }
	mutable._webgl = { gl: {} }
	mutable.setPointerCapture = capture
	mutable.releasePointerCapture = release

	const scene: EventScene = {
		micrio: host,
		el,
		canvas,
		current,
		visible,
		camera,
		image,
		dispatched,
		render,
		drawSync,
		capture,
		release,
		ctx: undefined as unknown as EventContext,
		destroy() {
			micrio.remove()
		},
	}

	const ctx: SceneContext = {
		_micrio: host,
		_el: el,
		_panning: false,
		_pinching: false,
		_wheeling: false,
		_controlZoom: false,
		_twoFingerPan: false,
		_vars: {
			_drag: { _prev: undefined, _start: [0, 0, 0], _image: undefined },
			_dbltap: { _lastTapped: 0 },
			_pinch: { _image: undefined, _sDst: 0, _wasPanning: false },
		},
		_getVisible: () => get(scene.visible),
		_getImage: () => scene.image as unknown as MicrioImage | undefined,
		_dispatch: (type, detail) => {
			dispatched.push({ type, detail })
		},
		_activePointers: new Map(),
		_capturedPointerId: undefined,
		_pinchFactor: undefined,
		_pScale: 1,
		_hasUsedCtrl: false,
		_hasTouch: true,
	}
	scene.ctx = ctx
	return scene
}

/** A pointer event with a fixed `timeStamp`, so drag/velocity maths stays deterministic. */
export function pointer(type: string, init: PointerEventInit & { timeStamp?: number } = {}): PointerEvent {
	const { timeStamp, ...rest } = init
	const ev = new PointerEvent(type, { bubbles: true, cancelable: true, ...rest })
	if (timeStamp !== undefined) {
		Object.defineProperty(ev, 'timeStamp', { value: timeStamp })
	}
	return ev
}

/** One `Touch` for a `TouchEvent`. */
export function touch(id: number, clientX: number, clientY: number, target: EventTarget): Touch {
	return new Touch({ identifier: id, target, clientX, clientY })
}

/** A `TouchEvent` whose `touches`/`targetTouches`/`changedTouches` are the given touches. */
export function touchEvent(type: string, touches: Touch[]): TouchEvent {
	return new TouchEvent(type, {
		touches,
		targetTouches: touches,
		changedTouches: touches,
		bubbles: true,
		cancelable: true,
	})
}

/** A macOS gesture event: `'scale' in e` is what the handler sniffs. */
export function gesture(type: string, init: { scale: number; clientX: number; clientY: number }): Event {
	const ev = new Event(type, { bubbles: true, cancelable: true })
	Object.assign(ev, init)
	return ev
}

/**
 * Saves the `Browser` flags, applies `overrides`, and returns a restore function.
 * `Browser` is a plain object of data properties, so a test can just assign.
 */
export function stubBrowser(overrides: Partial<typeof Browser>): () => void {
	const saved = { ...Browser }
	Object.assign(Browser, overrides)
	return () => {
		Object.assign(Browser, saved)
	}
}

/**
 * Forces a device pixel ratio on the scene: the window value, the camera viewport
 * ratio and the canvas buffer size all move together, exactly as `Canvas.onresize`
 * would set them on a retina display.
 */
export function stubDpr(scene: EventScene, ratio: number): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio')
	Object.defineProperty(globalThis, 'devicePixelRatio', { value: ratio, configurable: true })

	const { viewport } = scene.canvas
	const { ratio: oldRatio } = viewport
	const { width: oldW, height: oldH } = scene.el
	viewport.ratio = ratio
	scene.el.width = viewport.width * ratio
	scene.el.height = viewport.height * ratio

	return () => {
		viewport.ratio = oldRatio
		scene.el.width = oldW
		scene.el.height = oldH
		if (descriptor === undefined) {
			delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio
		} else {
			Object.defineProperty(globalThis, 'devicePixelRatio', descriptor)
		}
	}
}
