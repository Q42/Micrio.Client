import { afterEach, describe, expect, it, vi } from 'vitest'

import { DragHandler } from '$core/events/drag'
import { PointerPinchHandler } from '$core/events/pointer-pinch'
import { makeEventScene, pointer, type EventScene } from './event-fixture'

/**
 * `PointerPinchHandler` — the Pointer Events path used on Android, Windows
 * touchscreens and anywhere that is not iOS.
 *
 * It listens on `_micrio` for `pointerdown`, on `window` for `pointerup` /
 * `pointercancel`, and adds a capturing `pointermove` on `window` only while a
 * pinch is live. The fake `EventContext` records the active-pointer map, so the
 * two- and three-finger bookkeeping is asserted directly.
 */

let scene: EventScene | undefined
let drag: DragHandler | undefined
let handler: PointerPinchHandler | undefined

function setup(): { scene: EventScene; drag: DragHandler; handler: PointerPinchHandler } {
	scene = makeEventScene()
	drag = new DragHandler(scene.ctx)
	handler = new PointerPinchHandler(scene.ctx, drag)
	return { scene, drag, handler }
}

afterEach(() => {
	handler?.unhook()
	drag?.unhook()
	scene?.destroy()
	handler = undefined
	drag = undefined
	scene = undefined
	vi.restoreAllMocks()
})

/** A touch pointer event; the dispatch target is the element it is sent to. */
function touchPointer(
	type: string,
	pointerId: number,
	clientX: number,
	clientY: number,
	_target: EventTarget,
): PointerEvent {
	return pointer(type, { pointerType: 'touch', pointerId, clientX, clientY, button: 0 })
}

describe('PointerPinchHandler — hooking', () => {
	it('hooks and unhooks, clearing the active pointers', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 0, 0, s.el))
		expect(s.ctx._activePointers.size).toBe(1)

		h.unhook()
		h.unhook()
		expect(s.ctx._activePointers.size).toBe(0)

		// The pointerdown listener is gone
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 0, 0, s.el))
		expect(s.ctx._activePointers.size).toBe(0)
	})

	it('ends a pinch in flight when unhooked', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))
		expect(s.ctx._pinching).toBe(true)

		// The move/up listeners are gone with the hook, so nothing can ever end the pinch:
		// the flag has to be cleared here or every later drag and pinch is ignored.
		h.unhook()
		expect(s.ctx._pinching).toBe(false)
		expect(s.micrio.dataset.pinching).toBeUndefined()
		expect(s.image?.camera._pinchStop).toHaveBeenCalled()
	})
})

describe('PointerPinchHandler — start', () => {
	it('tracks a first touch without pinching', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		expect(s.ctx._activePointers.get(1)).toEqual({ x: 100, y: 100 })
		expect(s.ctx._pinching).toBe(false)
	})

	it('starts a pinch on the second touch', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))

		expect(s.ctx._pinching).toBe(true)
		expect(s.ctx._vars._pinch._image).toBe(s.image)
		expect(s.ctx._vars._pinch._sDst).toBe(40)
		expect(s.image?.camera._pinchStart).toHaveBeenCalled()
		expect(s.dispatched.map((d) => d.type)).toEqual(['pinchstart'])
	})

	it('ignores a non-touch pointer type', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 }))
		expect(s.ctx._activePointers.size).toBe(0)
	})

	it('ignores a touch that did not start on the canvas', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.micrio.dispatchEvent(touchPointer('pointerdown', 1, 0, 0, s.micrio))
		expect(s.ctx._activePointers.size).toBe(0)
	})

	it('does not restart a pinch that is already running', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))
		expect(s.ctx._pinching).toBe(true)

		// A third touch is tracked but never re-pinches
		s.el.dispatchEvent(touchPointer('pointerdown', 3, 180, 100, s.el))
		expect(s.ctx._activePointers.size).toBe(3)
		expect(s.image?.camera._pinchStart).toHaveBeenCalledTimes(1)
	})
})

describe('PointerPinchHandler — move', () => {
	it('applies the pinch from the two pointers', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))

		globalThis.dispatchEvent(touchPointer('pointermove', 1, 100, 100, s.el))
		globalThis.dispatchEvent(touchPointer('pointermove', 2, 180, 100, s.el))
		expect(s.image?.camera._pinch).toHaveBeenCalledWith(100, 100, 180, 100)
		expect(s.ctx._activePointers.get(2)).toEqual({ x: 180, y: 100 })
	})

	it('ignores an unknown pointer and a non-touch move', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))

		globalThis.dispatchEvent(touchPointer('pointermove', 99, 0, 0, s.el))
		globalThis.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 }))
		globalThis.dispatchEvent(new Event('pointermove'))
		expect(s.image?.camera._pinch).not.toHaveBeenCalled()
		expect(s.ctx._activePointers.get(1)).toEqual({ x: 100, y: 100 })
	})

	it('stops applying the pinch when a third pointer joins', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 3, 180, 100, s.el))

		globalThis.dispatchEvent(touchPointer('pointermove', 1, 120, 100, s.el))
		expect(s.image?.camera._pinch).not.toHaveBeenCalled()
	})
})

describe('PointerPinchHandler — end', () => {
	it('ends the pinch and resumes panning for the remaining pointer', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))

		globalThis.dispatchEvent(touchPointer('pointerup', 1, 100, 100, s.el))
		expect(s.ctx._activePointers.size).toBe(1)
		expect(s.ctx._pinching).toBe(false)
		expect(s.image?.camera._pinchStop).toHaveBeenCalled()
		expect(s.dispatched.map((d) => d.type)).toContain('pinchend')
		expect(s.ctx._panning).toBe(true)
	})

	it('ignores a non-touch pointer up', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		globalThis.dispatchEvent(pointer('pointerup', { pointerType: 'mouse', pointerId: 1 }))
		expect(s.ctx._activePointers.size).toBe(0)
	})

	it('handles pointercancel like pointerup', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(touchPointer('pointerdown', 1, 100, 100, s.el))
		s.el.dispatchEvent(touchPointer('pointerdown', 2, 140, 100, s.el))

		globalThis.dispatchEvent(touchPointer('pointercancel', 2, 140, 100, s.el))
		expect(s.ctx._pinching).toBe(false)
		expect(s.image?.camera._pinchStop).toHaveBeenCalled()
	})
})
