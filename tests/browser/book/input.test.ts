import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { InputHandler } from '$book/input/input'
import { Vec3 } from '$book/core/vec3'
import type { OrbitCamera } from '$book/core/orbit-camera'

/**
 * `InputHandler`: the book's pointer state machine — orbit vs pan, page drag vs
 * page click, two-pointer pinch, and the wheel hit point.
 *
 * No `BookViewer` and no WebGL: the camera is a recording fake and the canvas is a
 * plain element, so every branch is reachable in isolation. One thing to keep in
 * mind is the coordinate space — the handler works in **CSS pixels from the canvas
 * element** (`clientX − rect.left`), while the renderer's backing buffer may be
 * DPR-scaled; the retina test pins that the two never mix.
 */

/** One fake `OrbitCamera` that records every call. */
interface FakeOrbit {
	_pan: Mock
	_rotate: Mock
	_zoom: Mock
	_isZoomedIn: Mock
	_freeCamMode: boolean
}

let canvas: HTMLCanvasElement
let camera: FakeOrbit
let handler: InputHandler
let activity: Mock
let onPrev: Mock
let onNext: Mock
let onPageClick: Mock
let onWheelZoom: Mock
let onDragStart: Mock
let onDragMove: Mock
let onDragEnd: Mock

let ids = 100
const pid = (): number => ++ids

function pointer(type: string, init: PointerEventInit): PointerEvent {
	return new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
}

function down(init: PointerEventInit): void {
	canvas.dispatchEvent(pointer('pointerdown', init))
}
function move(init: PointerEventInit): void {
	globalThis.dispatchEvent(pointer('pointermove', init))
}
function up(init: PointerEventInit): void {
	globalThis.dispatchEvent(pointer('pointerup', init))
}
function cancel(init: PointerEventInit): void {
	globalThis.dispatchEvent(pointer('pointercancel', init))
}

beforeEach(() => {
	canvas = document.createElement('canvas')
	canvas.style.cssText = 'width: 400px; height: 300px; display: block;'
	document.body.append(canvas)
	// A canvas at (100, 50) sized 400x300, in CSS pixels.
	canvas.getBoundingClientRect = () =>
		({
			left: 100,
			top: 50,
			right: 500,
			bottom: 350,
			width: 400,
			height: 300,
			x: 100,
			y: 50,
			toJSON: () => ({}),
		}) as DOMRect

	camera = { _pan: vi.fn(), _rotate: vi.fn(), _zoom: vi.fn(), _isZoomedIn: vi.fn(() => false), _freeCamMode: false }
	activity = vi.fn()
	handler = new InputHandler(canvas, camera as unknown as OrbitCamera, activity)

	onPrev = vi.fn()
	onNext = vi.fn()
	onPageClick = vi.fn(() => null)
	onWheelZoom = vi.fn(() => new Vec3(1, 2, 3))
	onDragStart = vi.fn()
	onDragMove = vi.fn()
	onDragEnd = vi.fn()
	handler._onPrevPage = onPrev
	handler._onNextPage = onNext
	handler._onPageClick = onPageClick as unknown as InputHandler['_onPageClick']
	handler._onWheelZoom = onWheelZoom as unknown as InputHandler['_onWheelZoom']
	handler._onPageDragStart = onDragStart
	handler._onPageDragMove = onDragMove
	handler._onPageDragEnd = onDragEnd
})

afterEach(() => {
	canvas.remove()
	vi.restoreAllMocks()
})

describe('InputHandler — pointer down', () => {
	it('blurs the active element and cancels the native gesture', () => {
		const input = document.createElement('input')
		document.body.append(input)
		input.focus()

		const ev = pointer('pointerdown', { pointerId: pid(), pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		canvas.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(true)
		expect(document.activeElement).not.toBe(input)
		expect(activity).toHaveBeenCalled()
		input.remove()
	})

	it('ignores a mouse button beyond the primary pair', () => {
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 3, clientX: 150, clientY: 150 })
		expect(activity).not.toHaveBeenCalled()

		move({ pointerId: id, clientX: 250, clientY: 150 })
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		move({ pointerId: id, clientX: 250, clientY: 150 })
		expect(camera._pan).not.toHaveBeenCalled()
		expect(camera._rotate).not.toHaveBeenCalled()
	})

	it('starts a pan from a plain mouse press', () => {
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		expect(handler._operation).toBe('pan')
	})

	it('starts a pan from a touch press', () => {
		const id = pid()
		down({ pointerId: id, pointerType: 'touch', button: 0, clientX: 150, clientY: 150 })
		expect(handler._operation).toBe('pan')
	})
})

describe('InputHandler — orbit detection', () => {
	it.each([
		['the right button', { button: 2 }],
		['the middle button', { button: 1 }],
		['Ctrl + left', { button: 0, ctrlKey: true }],
		['Cmd + left', { button: 0, metaKey: true }],
	])('starts an orbit from %s', (_label, init) => {
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', clientX: 150, clientY: 150, ...init })
		expect(handler._operation).toBe('orbit')
	})

	it('never orbits a touch or pen pointer', () => {
		for (const pointerType of ['touch', 'pen']) {
			canvas.remove()
			canvas = document.createElement('canvas')
			document.body.append(canvas)
			canvas.getBoundingClientRect = () =>
				({
					left: 0,
					top: 0,
					right: 400,
					bottom: 300,
					width: 400,
					height: 300,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect
			handler = new InputHandler(canvas, camera as unknown as OrbitCamera, activity)
			const id = pid()
			down({ pointerId: id, pointerType, button: 2, clientX: 150, clientY: 150 })
			expect(handler._operation, pointerType).toBe('pan')
			up({ pointerId: id })
		}
	})

	it('passes the free-camera mode through to the rotation axis', () => {
		camera._freeCamMode = true
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 2, clientX: 150, clientY: 150 })
		move({ pointerId: id, clientX: 170, clientY: 130 })
		expect(camera._rotate).toHaveBeenCalledWith(20, -20, false)
	})
})

describe('InputHandler — single pointer', () => {
	it('pages a zoomed-out drag once it clears the threshold', () => {
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		move({ pointerId: id, clientX: 152, clientY: 150 })
		expect(onDragStart).not.toHaveBeenCalled()

		move({ pointerId: id, clientX: 156, clientY: 152 })
		expect(onDragStart).toHaveBeenCalledWith(150, 150)
		expect(onDragMove).toHaveBeenLastCalledWith(156, 152)
		expect(camera._pan).not.toHaveBeenCalled()

		// The drag start fires only once
		move({ pointerId: id, clientX: 170, clientY: 160 })
		expect(onDragStart).toHaveBeenCalledTimes(1)
	})

	it('pans while zoomed in, with no page drag', () => {
		camera._isZoomedIn.mockReturnValue(true)
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		move({ pointerId: id, clientX: 170, clientY: 120 })
		expect(camera._pan).toHaveBeenCalledWith(20, -30)
		expect(onDragStart).not.toHaveBeenCalled()
		expect(onDragMove).not.toHaveBeenCalled()
	})

	it('uses the zoomed-in override when one is wired up', () => {
		handler._isZoomedInFn = () => true
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		move({ pointerId: id, clientX: 170, clientY: 150 })
		expect(camera._pan).toHaveBeenCalledWith(20, 0)
		// The override replaces the camera's own answer
		expect(camera._isZoomedIn).not.toHaveBeenCalled()
	})

	it('ignores a move for a pointer it never saw', () => {
		move({ pointerId: pid(), clientX: 200, clientY: 200 })
		expect(camera._pan).not.toHaveBeenCalled()
		expect(camera._rotate).not.toHaveBeenCalled()
	})
})

describe('InputHandler — click', () => {
	it('turns the page forward and keeps the grab row', () => {
		onPageClick.mockReturnValue({ direction: 'next', grabRow: 7 })
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 250, clientY: 200 })
		up({ pointerId: id, clientX: 250, clientY: 200 })
		expect(onPageClick).toHaveBeenCalledWith(250, 200)
		expect(onNext).toHaveBeenCalled()
		expect(onPrev).not.toHaveBeenCalled()
		expect(handler._lastClickGrabRow).toBe(7)
	})

	it('turns the page backward', () => {
		onPageClick.mockReturnValue({ direction: 'prev', grabRow: 2 })
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 200 })
		up({ pointerId: id, clientX: 150, clientY: 200 })
		expect(onPrev).toHaveBeenCalled()
		expect(onNext).not.toHaveBeenCalled()
		expect(handler._lastClickGrabRow).toBe(2)
	})

	it('leaves the page alone when the hit test misses', () => {
		onPageClick.mockReturnValue(null)
		handler._lastClickGrabRow = 9
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 200 })
		up({ pointerId: id, clientX: 150, clientY: 200 })
		expect(onPrev).not.toHaveBeenCalled()
		expect(onNext).not.toHaveBeenCalled()
		// A finished gesture clears the leftover row
		expect(handler._lastClickGrabRow).toBeNull()
	})

	it('ends a dragged page instead of clicking it', () => {
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		move({ pointerId: id, clientX: 180, clientY: 150 })
		up({ pointerId: id, clientX: 180, clientY: 150 })
		expect(onDragEnd).toHaveBeenCalled()
		expect(onPageClick).not.toHaveBeenCalled()
	})
})

describe('InputHandler — two pointers', () => {
	it('orbits with two pointers while zoomed in, and pinches', () => {
		camera._isZoomedIn.mockReturnValue(true)
		const a = pid()
		const b = pid()
		down({ pointerId: a, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 })
		down({ pointerId: b, pointerType: 'touch', button: 0, clientX: 200, clientY: 100 })
		expect(handler._operation).toBe('orbit')

		move({ pointerId: b, pointerType: 'touch', clientX: 220, clientY: 140 })
		// The midpoint moved by 10 horizontally and 20 vertically, doubled
		expect(camera._rotate).toHaveBeenCalledWith(0, 40, true)
		// The pointers moved 40px apart, quadrupled into the zoom delta
		const expectedZoom = (Math.hypot(100 - 200, 100 - 100) - Math.hypot(100 - 220, 100 - 140)) * 4
		const zoomDelta = camera._zoom.mock.calls[0]?.[0] as number
		expect(zoomDelta).toBeCloseTo(expectedZoom, 6)
		expect(camera._pan).not.toHaveBeenCalled()
	})

	it('pans with two pointers while zoomed out', () => {
		const a = pid()
		const b = pid()
		down({ pointerId: a, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 })
		down({ pointerId: b, pointerType: 'touch', button: 0, clientX: 200, clientY: 100 })
		expect(handler._operation).toBe('pan')

		move({ pointerId: b, pointerType: 'touch', clientX: 220, clientY: 100 })
		expect(camera._pan).toHaveBeenCalledWith(20, 0)
	})

	it('skips the pinch zoom when the pointers coincide', () => {
		const a = pid()
		const b = pid()
		down({ pointerId: a, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 })
		down({ pointerId: b, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 })
		move({ pointerId: b, pointerType: 'touch', clientX: 100, clientY: 100 })
		expect(camera._zoom).not.toHaveBeenCalled()
	})

	it('resets to nothing when one of two pointers lifts', () => {
		const a = pid()
		const b = pid()
		down({ pointerId: a, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 })
		down({ pointerId: b, pointerType: 'touch', button: 0, clientX: 200, clientY: 100 })
		up({ pointerId: b, clientX: 200, clientY: 100 })
		expect(handler._operation).toBe('none')

		// The single remaining pointer does not suddenly pan
		move({ pointerId: a, pointerType: 'touch', clientX: 150, clientY: 100 })
		expect(camera._pan).not.toHaveBeenCalled()
		expect(camera._rotate).not.toHaveBeenCalled()
	})

	it('treats pointercancel like pointerup', () => {
		const a = pid()
		const b = pid()
		down({ pointerId: a, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 })
		down({ pointerId: b, pointerType: 'touch', button: 0, clientX: 200, clientY: 100 })
		cancel({ pointerId: b })
		expect(handler._operation).toBe('none')
	})
})

describe('InputHandler — wheel', () => {
	it('reports the canvas-relative point and passes the hit to the camera', () => {
		const hit = new Vec3(1, 2, 3)
		onWheelZoom.mockReturnValue(hit)
		const ev = new WheelEvent('wheel', { deltaY: 120, clientX: 260, clientY: 130, bubbles: true, cancelable: true })
		canvas.dispatchEvent(ev)

		expect(onWheelZoom).toHaveBeenCalledWith(160, 80)
		expect(camera._zoom).toHaveBeenCalledWith(120, hit)
		expect(ev.defaultPrevented).toBe(true)
		expect(activity).toHaveBeenCalled()
	})

	it('zooms without a hit point when the ray misses', () => {
		onWheelZoom.mockReturnValue(null)
		canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, clientX: 100, clientY: 50, bubbles: true }))
		expect(camera._zoom).toHaveBeenCalledWith(-40, undefined)
	})

	it('zooms without a hit test when none is wired up', () => {
		handler._onWheelZoom = null
		canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, clientX: 100, clientY: 50, bubbles: true }))
		expect(camera._zoom).toHaveBeenCalledWith(10, undefined)
	})

	it('prevents the native context menu', () => {
		const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
		canvas.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(true)
	})
})

describe('InputHandler — retina', () => {
	it('keeps coordinates in CSS pixels when the drawing buffer is DPR-scaled', () => {
		const ev = new WheelEvent('wheel', { deltaY: 30, clientX: 260, clientY: 130, bubbles: true, cancelable: true })

		// A DPR-1 buffer
		canvas.width = 400
		canvas.height = 300
		canvas.dispatchEvent(ev)
		const atOne = onWheelZoom.mock.calls.at(-1)

		// A DPR-2 buffer: the CSS layout (and therefore the rect) is unchanged
		canvas.width = 800
		canvas.height = 600
		canvas.dispatchEvent(
			new WheelEvent('wheel', { deltaY: 30, clientX: 260, clientY: 130, bubbles: true, cancelable: true }),
		)
		const atTwo = onWheelZoom.mock.calls.at(-1)

		expect(atOne).toEqual([160, 80])
		expect(atTwo).toEqual(atOne)
	})

	it('keeps drag deltas in CSS pixels at any buffer size', () => {
		camera._isZoomedIn.mockReturnValue(true)
		canvas.width = 800
		canvas.height = 600
		const id = pid()
		down({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 150, clientY: 150 })
		move({ pointerId: id, clientX: 190, clientY: 150 })
		// The same 40 CSS px the pointer actually moved
		expect(camera._pan).toHaveBeenCalledWith(40, 0)
	})
})
