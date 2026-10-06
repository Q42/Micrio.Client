import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { Grid } from '$grid/grid'
import type { MicrioImage } from '$core/image'
import { bundleWithFreshId } from '../../../fixtures/bundles'
import { collectEvents, mountViewer, waitFor, type Viewer } from '../../../helpers/viewer'

/**
 * The interaction layer end to end, on a real `<micr-io>`.
 *
 * The handler suites drive a hand-built `EventContext`; this one goes through the
 * actual element so the settings-driven hooking, the real camera and the DOM event
 * target are exercised together. **One viewer for the whole file** (Chromium keeps
 * only a small number of WebGL contexts): `setup.ts` empties `<body>` before every
 * test, so each `beforeEach` re-appends the element — which also exercises the
 * disconnect/reconnect path on every test. Each test resets the camera and the
 * interaction flags itself.
 *
 * Retina is asserted at the seam the events layer owns: the coordinates handed to
 * the camera must not change with `devicePixelRatio`. The ratio is changed through
 * the real `Canvas.onresize()` path, so the engine viewport, the buffer size and
 * the camera all see the new DPR.
 */

let viewer: Viewer
let image: MicrioImage

/** A pointer event whose `timeStamp` is fixed, so drag maths is deterministic. */
type PointerInit = PointerEventInit & { timeStamp?: number }
function pointer(type: string, init: PointerInit = {}): PointerEvent {
	const { timeStamp, ...rest } = init
	const ev = new PointerEvent(type, { ...rest, bubbles: true, cancelable: true })
	if (timeStamp !== undefined) {
		Object.defineProperty(ev, 'timeStamp', { value: timeStamp })
	}
	return ev
}

function canvas(): HTMLCanvasElement {
	return viewer.el.canvas.element
}

/** Puts the camera back at the full-image view and clears interaction state. */
async function reset(): Promise<void> {
	image.camera.setView([0, 0, 1, 1], { noLimit: true })
	const { events } = viewer.el
	events._panning = false
	events._pinching = false
	events._wheeling = false
	events._twoFingerPan = false
	events._controlZoom = false
	events._hasUsedCtrl = false
	events._pScale = 1
	events._activePointers.clear()
	events._capturedPointerId = undefined
	await nextFrame()
}

/** Sets the camera view (zoomed in, so pans are not clamped) and awaits a frame. */
async function atView(view: [number, number, number, number]): Promise<void> {
	image.camera.setView(view, { noLimit: true })
	await nextFrame()
}

/** Resolves on the next animation frame. */
function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			resolve()
		})
	})
}

/** Waits until the camera scale has changed. */
async function scaleChanged(before: number): Promise<boolean> {
	try {
		await waitFor(() => image.camera.getScale() !== before, 2000, 'camera scale')
		return true
	} catch {
		return false
	}
}

beforeAll(async () => {
	// Fixed at the page origin so every coordinate assertion is a plain client position.
	viewer = mountViewer({}, 'position: fixed; left: 0; top: 0; width: 800px; height: 600px; display: block;')

	const bundle = bundleWithFreshId()
	await viewer.open(bundle)
	await waitFor(() => viewer.el.$current?.id === bundle.id, 6000, 'current image')
	await waitFor(() => (viewer.el.$current?.camera.getScale() ?? 0) > 0, 6000, 'camera layout')
	const current = viewer.el.$current
	if (!current) {
		throw new Error('no current image')
	}
	image = current
	// Keyboard hooks are off by default (`hookKeys` defaults false); this file wants them.
	viewer.el.events.hookKeys()
	// Synthetic pointer events cannot capture, and the drag handler captures past 10px.
	viewer.el.setPointerCapture = () => {}
	viewer.el.releasePointerCapture = () => {}
})

beforeEach(() => {
	// `setup.ts` emptied <body>; re-connecting the shared viewer is also the reconnect path.
	if (!viewer.el.isConnected) {
		document.body.append(viewer.el)
	}
})

afterEach(async () => {
	await reset()
	// The capture test replaces the stub directly; `vi.restoreAllMocks` cannot undo that.
	viewer.el.setPointerCapture = () => {}
	Grid._handlingKeys = false
	vi.restoreAllMocks()
})

afterAll(() => {
	viewer.destroy()
})

describe('interaction — mouse drag', () => {
	it('pans the camera and brackets it with panstart/panend', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const seen = collectEvents(viewer.el, ['panstart', 'panend'])
		const pan = vi.spyOn(image.camera, 'pan')
		const el = canvas()
		el.dispatchEvent(pointer('pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 300 }))
		expect(viewer.el.dataset.panning).toBe('')

		// The first move records the baseline, the second pans by the delta
		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 470, clientY: 300 }))
		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 540, clientY: 300 }))
		viewer.el.dispatchEvent(pointer('pointerup', { pointerId: 1, clientX: 540, clientY: 300 }))

		expect(viewer.el.dataset.panning).toBeUndefined()
		expect(seen.types).toEqual(['panstart', 'panend'])
		// Panning follows the pointer: the previous point minus the current one
		expect(pan).toHaveBeenCalledWith(-70, 0)
	})

	it('captures the pointer only after a significant move', () => {
		const capture = vi.fn()
		viewer.el.setPointerCapture = capture
		const el = canvas()
		el.dispatchEvent(pointer('pointerdown', { pointerId: 2, button: 0, clientX: 400, clientY: 300 }))
		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 405, clientY: 300 }))
		expect(capture).not.toHaveBeenCalled()

		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 440, clientY: 300 }))
		expect(capture).toHaveBeenCalledWith(2)
		viewer.el.dispatchEvent(pointer('pointerup', { pointerId: 2, clientX: 440, clientY: 300 }))
	})

	it('still ends with a panend on a fast flick', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const seen = collectEvents(viewer.el, ['panstart', 'panend'])
		const el = canvas()
		el.dispatchEvent(pointer('pointerdown', { pointerId: 3, button: 0, clientX: 600, clientY: 300, timeStamp: 0 }))
		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 3, clientX: 560, clientY: 300, timeStamp: 40 }))
		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 3, clientX: 200, clientY: 300, timeStamp: 90 }))
		viewer.el.dispatchEvent(pointer('pointerup', { pointerId: 3, clientX: 200, clientY: 300, timeStamp: 100 }))
		expect(seen.types).toEqual(['panstart', 'panend'])
	})

	it('ignores touch drags when two-finger pan is forced', () => {
		viewer.el.events._twoFingerPan = true
		const seen = collectEvents(viewer.el, ['panstart'])
		canvas().dispatchEvent(
			pointer('pointerdown', { pointerId: 4, button: 0, pointerType: 'touch', clientX: 400, clientY: 300 }),
		)
		expect(seen.types).toEqual([])
		expect(viewer.el.dataset.panning).toBeUndefined()
	})
})

describe('interaction — wheel', () => {
	it('zooms in on a negative wheel delta', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const before = image.camera.getScale()
		canvas().dispatchEvent(
			new WheelEvent('wheel', { deltaY: -400, clientX: 400, clientY: 300, bubbles: true, cancelable: true }),
		)
		expect(await scaleChanged(before)).toBe(true)
	})

	it('requires Ctrl when controlZoom is set', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		viewer.el.events._controlZoom = true
		const before = image.camera.getScale()
		canvas().dispatchEvent(
			new WheelEvent('wheel', { deltaY: -400, clientX: 400, clientY: 300, bubbles: true, cancelable: true }),
		)
		// Nothing moves without Ctrl
		expect(image.camera.getScale()).toBeCloseTo(before, 9)

		canvas().dispatchEvent(
			new WheelEvent('wheel', {
				deltaY: -400,
				ctrlKey: true,
				clientX: 400,
				clientY: 300,
				bubbles: true,
				cancelable: true,
			}),
		)
		expect(await scaleChanged(before)).toBe(true)
	})
})

describe('interaction — keyboard and double-click', () => {
	it('pans with the arrow keys', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const pan = vi.spyOn(image.camera, 'pan')
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
		// Half the element width, animated over 150ms
		expect(pan).toHaveBeenCalledWith(400, 0, 150)
	})

	it('yields the keys to a grid that is handling them', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const pan = vi.spyOn(image.camera, 'pan')
		Grid._handlingKeys = true
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
		expect(pan).not.toHaveBeenCalled()
	})

	it('zooms on a double-click', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const before = image.camera.getScale()
		canvas().dispatchEvent(new MouseEvent('dblclick', { clientX: 400, clientY: 300, bubbles: true }))
		expect(await scaleChanged(before)).toBe(true)
	})
})

describe('interaction — touch and pinch', () => {
	it('pans with a single touch pointer', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const pan = vi.spyOn(image.camera, 'pan')
		const el = canvas()
		el.dispatchEvent(
			pointer('pointerdown', { pointerId: 10, button: 0, pointerType: 'touch', clientX: 400, clientY: 300 }),
		)
		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 10, pointerType: 'touch', clientX: 430, clientY: 300 }))
		viewer.el.dispatchEvent(pointer('pointermove', { pointerId: 10, pointerType: 'touch', clientX: 470, clientY: 300 }))
		viewer.el.dispatchEvent(pointer('pointerup', { pointerId: 10, pointerType: 'touch', clientX: 470, clientY: 300 }))
		expect(pan).toHaveBeenCalledWith(-40, 0)
	})

	it('pinches with two touch pointers and reports the custom events', async () => {
		await atView([0.25, 0.25, 0.5, 0.5])
		const seen = collectEvents(viewer.el, ['pinchstart', 'pinchend'])
		const before = image.camera.getScale()
		const el = canvas()
		el.dispatchEvent(
			pointer('pointerdown', { pointerId: 20, button: 0, pointerType: 'touch', clientX: 300, clientY: 300 }),
		)
		el.dispatchEvent(
			pointer('pointerdown', { pointerId: 21, button: 0, pointerType: 'touch', clientX: 500, clientY: 300 }),
		)
		expect(viewer.el.dataset.pinching).toBe('')

		globalThis.dispatchEvent(
			pointer('pointermove', { pointerId: 20, pointerType: 'touch', clientX: 260, clientY: 300 }),
		)
		globalThis.dispatchEvent(
			pointer('pointermove', { pointerId: 21, pointerType: 'touch', clientX: 540, clientY: 300 }),
		)
		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 21, pointerType: 'touch', clientX: 540, clientY: 300 }))

		expect(viewer.el.dataset.pinching).toBeUndefined()
		expect(seen.types).toContain('pinchstart')
		expect(seen.types).toContain('pinchend')
		expect(await scaleChanged(before)).toBe(true)
	})
})

describe('interaction — retina', () => {
	it('hands the camera the same CSS anchor at any device pixel ratio', async () => {
		const zoom = vi.spyOn(image.camera, 'zoom')
		await atView([0.25, 0.25, 0.5, 0.5])
		wheel()
		const atOne = zoom.mock.calls.at(-1)

		await atView([0.25, 0.25, 0.5, 0.5])
		const restore = setDpr(2)
		try {
			// The real resize path ran: the engine viewport now reports ratio 2
			expect(viewer.el.canvas.viewport.ratio).toBe(2)
			wheel()
			const atTwo = zoom.mock.calls.at(-1)
			expect(atTwo).toEqual(atOne)
			// The anchor itself is still the element-relative CSS position
			expect(atTwo?.slice(2, 4)).toEqual([400, 300])
		} finally {
			restore()
		}
	})

	it('round-trips a screen point through image coordinates at both ratios', () => {
		const px = 320
		const py = 240
		const check = () => {
			const coo = image.camera.getCoo(px, py, false, true)
			const xy = image.camera.getXY(coo[0] ?? 0, coo[1] ?? 0)
			expect(xy[0]).toBeCloseTo(px, 1)
			expect(xy[1]).toBeCloseTo(py, 1)
		}

		check()
		const restore = setDpr(2)
		try {
			expect(viewer.el.canvas.viewport.ratio).toBe(2)
			check()
		} finally {
			restore()
		}
	})
})

/** A wheel at a fixed CSS position, used by the retina case. */
function wheel(): void {
	canvas().dispatchEvent(
		new WheelEvent('wheel', { deltaY: -300, clientX: 400, clientY: 300, bubbles: true, cancelable: true }),
	)
}

/**
 * Changes the device pixel ratio through `Canvas.onresize()`, so the engine
 * viewport, the canvas buffer and the camera all see it — exactly what a real
 * retina display does.
 */
function setDpr(ratio: number): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio')
	Object.defineProperty(globalThis, 'devicePixelRatio', { value: ratio, configurable: true })
	viewer.el.canvas.onresize()
	return () => {
		if (descriptor === undefined) {
			delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio
		} else {
			Object.defineProperty(globalThis, 'devicePixelRatio', descriptor)
		}
		viewer.el.canvas.onresize()
	}
}
