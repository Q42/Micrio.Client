import { afterEach, describe, expect, it, vi } from 'vitest'

import { DragHandler } from '$core/events/drag'
import { makeEventScene, pointer, type EventScene } from './event-fixture'

/**
 * `DragHandler`: pointer panning, pointer capture and the kinetic release.
 *
 * The handler attaches to `_micrio` but only accepts a press whose target is `_el`
 * (or a `[data-scroll-through]` descendant), so every dispatch below goes to the
 * canvas child and bubbles. `start`/`stop` are public arrows and are also driven
 * directly for the `force`/`keepAnimations`/`noKinetic`/`noDispatch` seams that no
 * DOM event can reach.
 */

let scene: EventScene | undefined
let handler: DragHandler | undefined

function setup(): { scene: EventScene; handler: DragHandler } {
	scene = makeEventScene()
	handler = new DragHandler(scene.ctx)
	return { scene, handler }
}

afterEach(() => {
	handler?.unhook()
	scene?.destroy()
	handler = undefined
	scene = undefined
	vi.restoreAllMocks()
})

describe('DragHandler — hooking', () => {
	it('hooks and unhooks idempotently', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.hook()
		expect(s.micrio.dataset.hooked).toBe('')

		h.unhook()
		h.unhook()
		expect(s.micrio.dataset.hooked).toBeUndefined()
	})

	it('cancels the native dragstart', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		const ev = new Event('dragstart', { bubbles: true, cancelable: true })
		s.el.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(true)
	})
})

describe('DragHandler — start', () => {
	it('starts panning on a primary press on the canvas', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 1, clientX: 120, clientY: 90 }))

		expect(s.ctx._panning).toBe(true)
		expect(s.micrio.dataset.panning).toBe('')
		expect(s.ctx._vars._drag._start.slice(0, 2)).toEqual([120, 90])
		expect(s.ctx._vars._drag._image).toBe(s.image)
		expect(s.image?.canvas._kinetic.stop).toHaveBeenCalled()
		expect(s.image?.camera.stop).toHaveBeenCalled()
		expect(s.render).toHaveBeenCalled()
		expect(s.dispatched.map((d) => d.type)).toContain('panstart')
	})

	it('ignores a non-primary button', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 2, pointerId: 1, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(false)
		expect(s.dispatched).toHaveLength(0)
	})

	it('ignores a touch while two-finger panning is forced', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.ctx._twoFingerPan = true
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerType: 'touch', clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(false)

		// The same press with a mouse pointer still pans
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerType: 'mouse', clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(true)
	})

	it('ignores a press that did not start on the canvas', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.micrio.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(false)
	})

	it('accepts a press on a scroll-through descendant', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		const through = document.createElement('div')
		through.dataset.scrollThrough = ''
		s.el.append(through)
		through.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(true)
	})

	it('starts regardless of target when forced', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.start(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }), true)
		expect(s.ctx._panning).toBe(true)
	})

	it('keeps running animations when told to', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.start(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }), true, true)
		expect(s.image?.canvas._kinetic.stop).toHaveBeenCalled()
		// `camera.stop()` is the one the `keepAnimations` flag skips
		expect(s.image?.camera.stop).not.toHaveBeenCalled()
	})

	it('ignores a shift-press on an omni image', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		;(s.micrio as unknown as { $current?: unknown }).$current = { _isOmni: true }

		s.el.dispatchEvent(pointer('pointerdown', { button: 0, shiftKey: true, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(false)

		// Without shift the same omni image pans normally
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, shiftKey: false, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(true)
	})

	it('ignores a start while pinching', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.ctx._pinching = true
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(false)
	})

	it('ignores a second press while already panning', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(true)

		// A second finger does not restart the drag; the pinch layer stops the pan
		s.el.dispatchEvent(
			pointer('pointerdown', { button: 0, pointerId: 2, pointerType: 'touch', clientX: 40, clientY: 40 }),
		)
		expect(s.ctx._panning).toBe(true)
		expect(s.ctx._vars._drag._start.slice(0, 2)).toEqual([10, 10])
	})

	it('does nothing when there is no image under the pointer', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.image = undefined
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
		expect(s.ctx._panning).toBe(false)
	})
})

describe('DragHandler — move', () => {
	it('pans on the second move and captures the pointer past the threshold', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 5, clientX: 100, clientY: 100 }))

		// First move only records the baseline
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 5, clientX: 105, clientY: 100 }))
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
		expect(s.capture).not.toHaveBeenCalled()

		// Second move is past 10px: capture, then pan by previous - current
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 5, clientX: 120, clientY: 100 }))
		expect(s.capture).toHaveBeenCalledWith(5)
		expect(s.ctx._capturedPointerId).toBe(5)
		expect(s.image?.camera.pan).toHaveBeenCalledWith(-15, 0)

		// A third move keeps panning without re-capturing
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 5, clientX: 130, clientY: 110 }))
		expect(s.image?.camera.pan).toHaveBeenLastCalledWith(-10, -10)
		expect(s.capture).toHaveBeenCalledTimes(1)
	})

	it('leaves a slow drag uncaptured', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 6, clientX: 100, clientY: 100 }))
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 6, clientX: 103, clientY: 100 }))
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 6, clientX: 106, clientY: 100 }))
		expect(s.capture).not.toHaveBeenCalled()
		expect(s.image?.camera.pan).toHaveBeenCalledWith(-3, 0)
	})

	it('ignores a move without a press', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 10, clientY: 10 }))
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
	})
})

describe('DragHandler — stop', () => {
	it('releases capture, starts kinetic and reports the pan', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 8, clientX: 100, clientY: 100 }))
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 8, clientX: 140, clientY: 120 }))
		s.el.dispatchEvent(pointer('pointerup', { pointerId: 8, clientX: 140, clientY: 120 }))

		expect(s.ctx._panning).toBe(false)
		expect(s.micrio.dataset.panning).toBeUndefined()
		expect(s.release).toHaveBeenCalledWith(8)
		expect(s.image?.canvas._kinetic.start).toHaveBeenCalled()
		expect(s.ctx._vars._drag._prev).toBeUndefined()
		expect(s.ctx._vars._drag._image).toBeUndefined()

		const panend = s.dispatched.find((d) => d.type === 'panend')
		expect(panend).toBeDefined()
		const detail = panend?.detail as { duration: number; movedX: number; movedY: number }
		expect(detail.movedX).toBe(40)
		expect(detail.movedY).toBe(20)
		expect(typeof detail.duration).toBe('number')
	})

	it('suppresses the kinetic start on request', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.start(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }), true)
		h.stop(pointer('pointerup', { clientX: 12, clientY: 12 }), true)
		expect(s.image?.canvas._kinetic.start).not.toHaveBeenCalled()
		// The pan is still reported
		expect(s.dispatched.some((d) => d.type === 'panend')).toBe(true)
	})

	it('suppresses the panend event on request', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.start(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }), true)
		s.dispatched.length = 0
		h.stop(undefined, true, true)
		expect(s.dispatched).toHaveLength(0)
	})

	it('skips the kinetic start when the locked image is gone', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.start(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }), true)
		// The image was released between the press and the release
		s.ctx._vars._drag._image = undefined
		s.image = undefined
		h.stop(pointer('pointerup', { clientX: 12, clientY: 12 }))
		expect(s.ctx._panning).toBe(false)
		expect(s.dispatched.some((d) => d.type === 'panend')).toBe(true)
	})

	it('dispatches panend without detail for a bare stop', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.start(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }), true)
		const before = s.render.mock.calls.length
		h.stop()
		const panend = s.dispatched.find((d) => d.type === 'panend')
		expect(panend?.detail).toBeUndefined()
		// No event means no kinetic start and no extra render
		expect(s.image?.canvas._kinetic.start).not.toHaveBeenCalled()
		expect(s.render).toHaveBeenCalledTimes(before)
	})

	it('is a no-op when not panning', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.stop(pointer('pointerup', { clientX: 10, clientY: 10 }))
		expect(s.dispatched).toHaveLength(0)
		expect(s.image?.canvas._kinetic.start).not.toHaveBeenCalled()
	})
})

describe('DragHandler — window listeners', () => {
	it('keeps panning when the move is delivered on the window', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 20, clientX: 100, clientY: 100 }))

		// The pointer left the element, so the browser delivers its moves to the window.
		// Listening on `_micrio` only would drop them: the drag would freeze, and unless the
		// pointer came back inside the element no `pointerup` would ever end it.
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 20, clientX: 140, clientY: 100 }))
		expect(s.capture).toHaveBeenCalledWith(20)
		expect(s.ctx._capturedPointerId).toBe(20)

		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 20, clientX: 150, clientY: 100 }))
		expect(s.image?.camera.pan).toHaveBeenLastCalledWith(-10, 0)
	})

	it('releases panning when the pointer is lifted outside the element', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 21, clientX: 100, clientY: 100 }))

		// Below the 10px capture threshold, so the pointer was never captured
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 21, clientX: 103, clientY: 100 }))
		expect(s.capture).not.toHaveBeenCalled()

		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 21, clientX: 103, clientY: 100 }))
		expect(s.ctx._panning).toBe(false)
		expect(s.micrio.dataset.panning).toBeUndefined()

		// A later press starts a fresh drag instead of being ignored forever
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 22, clientX: 100, clientY: 100 }))
		expect(s.ctx._panning).toBe(true)
		expect(s.ctx._vars._drag._image).toBe(s.image)
	})

	it('survives a pointer capture the browser refuses', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		// An inactive pointer (a synthetic event, one the browser already cancelled) has no
		// capture to take and `setPointerCapture` throws; it must not escape the listener
		s.capture.mockImplementation(() => {
			throw new DOMException('no active pointer', 'NotFoundError')
		})
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 23, clientX: 100, clientY: 100 }))

		expect(() => {
			s.el.dispatchEvent(pointer('pointermove', { pointerId: 23, clientX: 140, clientY: 100 }))
		}).not.toThrow()
		expect(s.ctx._capturedPointerId).toBe(23)

		// One-shot: the next move does not call the throwing capture again, and still pans
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 23, clientX: 150, clientY: 100 }))
		expect(s.capture).toHaveBeenCalledTimes(1)
		expect(s.image?.camera.pan).toHaveBeenLastCalledWith(-10, 0)
	})
})

describe('DragHandler — pointercancel', () => {
	it('stops without kinetic or panend', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 9, clientX: 100, clientY: 100 }))
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 9, clientX: 140, clientY: 100 }))
		expect(s.ctx._capturedPointerId).toBe(9)

		globalThis.dispatchEvent(pointer('pointercancel', { pointerId: 9 }))
		expect(s.ctx._panning).toBe(false)
		expect(s.release).toHaveBeenCalledWith(9)
		expect(s.image?.canvas._kinetic.start).not.toHaveBeenCalled()
		expect(s.dispatched.some((d) => d.type === 'panend')).toBe(false)
	})

	it('ignores a cancel from a different pointer', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 10, clientX: 100, clientY: 100 }))
		s.el.dispatchEvent(pointer('pointermove', { pointerId: 10, clientX: 140, clientY: 100 }))

		globalThis.dispatchEvent(pointer('pointercancel', { pointerId: 99 }))
		expect(s.ctx._panning).toBe(true)
	})

	it('stops an uncaptured pan and is a no-op when idle', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		// Not panning: nothing happens
		globalThis.dispatchEvent(pointer('pointercancel', { pointerId: 11 }))
		expect(s.dispatched).toHaveLength(0)

		// Panning but never moved far enough to capture
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 12, clientX: 100, clientY: 100 }))
		s.dispatched.length = 0
		globalThis.dispatchEvent(pointer('pointercancel', { pointerId: 12 }))
		expect(s.ctx._panning).toBe(false)
		expect(s.dispatched).toHaveLength(0)
	})
})
