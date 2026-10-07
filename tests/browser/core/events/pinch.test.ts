import { afterEach, describe, expect, it, vi } from 'vitest'

import { DragHandler } from '$core/events/drag'
import { PinchHandler } from '$core/events/pinch'
import { makeEventScene, stubBrowser, touch, touchEvent, type EventScene } from './event-fixture'

/**
 * `PinchHandler` — the iOS touch path (`touchstart`/`touchmove`/`touchend`).
 *
 * `hook()` only attaches on iOS-with-touch, so the guard tests call the public
 * `start` directly and the wiring tests stub `Browser.iOS` per case. The shared
 * `pinch-shared.ts` body is covered from here and from `pointer-pinch.test.ts`.
 */

let scene: EventScene | undefined
let drag: DragHandler | undefined
let handler: PinchHandler | undefined

function setup(): { scene: EventScene; drag: DragHandler; handler: PinchHandler } {
	scene = makeEventScene()
	drag = new DragHandler(scene.ctx)
	handler = new PinchHandler(scene.ctx, drag)
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

describe('PinchHandler — hooking', () => {
	it('stays detached when the browser has no touch support', () => {
		const restore = stubBrowser({ iOS: true })
		try {
			const { scene: s, handler: h } = setup()
			s.ctx._hasTouch = false
			h.hook()
			h.unhook()
			s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
			expect(s.ctx._pinching).toBe(false)
		} finally {
			restore()
		}
	})

	it('attaches the touchstart listener only on iOS with touch', () => {
		const { scene: s, handler: h } = setup()

		// Not iOS: the touchstart is ignored
		s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		expect(s.ctx._pinching).toBe(false)

		const restore = stubBrowser({ iOS: true })
		try {
			h.hook()
			// A hook must be idempotent
			h.hook()
			s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
			expect(s.ctx._pinching).toBe(true)
		} finally {
			restore()
		}
	})

	it('removes the window listeners when unhooked mid-pinch', () => {
		const restore = stubBrowser({ iOS: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()
			s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
			expect(s.ctx._pinching).toBe(true)

			h.unhook()
			// Nothing can end the pinch once its listeners are gone, so the flag is cleared
			// here — otherwise it blocks every later drag and pinch for good.
			expect(s.ctx._pinching).toBe(false)
			expect(s.micrio.dataset.pinching).toBeUndefined()
			expect(s.image?.camera._pinchStop).toHaveBeenCalled()

			s.image?.camera._pinch.mockClear()
			globalThis.dispatchEvent(touchEvent('touchmove', [touch(1, 0, 0, s.el), touch(2, 80, 0, s.el)]))
			expect(s.image?.camera._pinch).not.toHaveBeenCalled()
		} finally {
			restore()
		}
	})

	it('ignores a non-TouchEvent and a browser without touch', () => {
		const { scene: s, handler: h } = setup()
		h.start(new Event('touchstart'))
		expect(s.ctx._pinching).toBe(false)

		const restore = stubBrowser({ hasTouch: false })
		try {
			h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
			expect(s.ctx._pinching).toBe(false)
		} finally {
			restore()
		}
	})
})

describe('PinchHandler — start', () => {
	it('starts a pinch from two touches', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 100, 100, s.el), touch(2, 140, 100, s.el)]))

		expect(s.ctx._pinching).toBe(true)
		expect(s.micrio.dataset.pinching).toBe('')
		expect(s.ctx._vars._pinch._image).toBe(s.image)
		expect(s.ctx._vars._pinch._sDst).toBe(40)
		expect(s.image?.camera._pinchStart).toHaveBeenCalled()
		expect(s.render).toHaveBeenCalled()
		expect(s.dispatched.map((d) => d.type)).toEqual(['pinchstart'])
	})

	it('also reports a pan start when two-finger pan is forced', () => {
		const { scene: s, handler: h } = setup()
		s.ctx._twoFingerPan = true
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		expect(s.dispatched.map((d) => d.type)).toEqual(['pinchstart', 'panstart'])
	})

	it('starts panning from a single touch', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 30, 30, s.el)]))
		// Not a pinch, but the drag handler is restarted for the remaining finger
		expect(s.ctx._pinching).toBe(false)
		expect(s.ctx._panning).toBe(true)
	})

	it('ignores a second touch when two-finger pan requires it', () => {
		const { scene: s, handler: h } = setup()
		s.ctx._twoFingerPan = true
		h.start(touchEvent('touchstart', [touch(1, 30, 30, s.el)]))
		expect(s.ctx._pinching).toBe(false)
		expect(s.ctx._panning).toBe(false)
		expect(s.dispatched).toHaveLength(0)
	})

	it('ends a running pinch when another two-touch start arrives', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		expect(s.ctx._pinching).toBe(true)

		h.start(touchEvent('touchstart', [touch(3, 0, 0, s.el), touch(4, 40, 0, s.el)]))
		expect(s.ctx._pinching).toBe(false)
		expect(s.image?.camera._pinchStop).toHaveBeenCalled()
	})

	it('does nothing for three touches', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el), touch(3, 80, 0, s.el)]))
		expect(s.ctx._pinching).toBe(false)
		expect(s.ctx._panning).toBe(false)
	})
})

describe('PinchHandler — move', () => {
	it('applies the pinch scale and forwards both touches', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 100, 100, s.el), touch(2, 140, 100, s.el)]))
		globalThis.dispatchEvent(touchEvent('touchmove', [touch(1, 100, 100, s.el), touch(2, 180, 100, s.el)]))

		expect(s.ctx._pinchFactor).toBe(2)
		expect(s.image?.camera._pinch).toHaveBeenCalledWith(100, 100, 180, 100)
	})

	it('ignores a move without two touches', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		globalThis.dispatchEvent(touchEvent('touchmove', [touch(1, 0, 0, s.el)]))
		globalThis.dispatchEvent(new Event('touchmove'))
		expect(s.image?.camera._pinch).not.toHaveBeenCalled()
	})

	it('returns when the pinch has no image', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		s.ctx._vars._pinch._image = undefined
		globalThis.dispatchEvent(touchEvent('touchmove', [touch(1, 0, 0, s.el), touch(2, 80, 0, s.el)]))
		expect(s.ctx._pinchFactor).toBeUndefined()
	})
})

describe('PinchHandler — stop', () => {
	it('ends the pinch and resumes panning for the remaining finger', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 100, 100, s.el), touch(2, 140, 100, s.el)]))

		globalThis.dispatchEvent(touchEvent('touchend', [touch(1, 100, 100, s.el)]))
		expect(s.ctx._pinching).toBe(false)
		expect(s.micrio.dataset.pinching).toBeUndefined()
		expect(s.image?.camera._pinchStop).toHaveBeenCalled()
		expect(s.dispatched.map((d) => d.type)).toContain('pinchend')
		// The one remaining touch is handed to the drag handler as a forced press
		expect(s.ctx._panning).toBe(true)
	})

	it('does not resume panning when no finger is left', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 100, 100, s.el), touch(2, 140, 100, s.el)]))
		globalThis.dispatchEvent(touchEvent('touchend', []))
		expect(s.ctx._pinching).toBe(false)
		expect(s.ctx._panning).toBe(false)
	})

	it('reports a pan end for a two-finger pan that did not start from a pan', () => {
		const { scene: s, handler: h } = setup()
		s.ctx._twoFingerPan = true
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		s.dispatched.length = 0

		globalThis.dispatchEvent(touchEvent('touchend', []))
		expect(s.dispatched.map((d) => d.type)).toEqual(['pinchend', 'panend'])
	})

	it('omits the pan end when the pinch interrupted an active pan', () => {
		const { scene: s, handler: h } = setup()
		s.ctx._twoFingerPan = true
		s.ctx._panning = true
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		s.dispatched.length = 0

		globalThis.dispatchEvent(touchEvent('touchend', []))
		expect(s.dispatched.map((d) => d.type)).toEqual(['pinchend'])
	})

	it('is a no-op when no pinch is running', () => {
		const { scene: s, handler: h } = setup()
		h.stop(touchEvent('touchend', []))
		expect(s.dispatched).toHaveLength(0)
	})

	it('ends a pinch from a mouse event without resuming a pan', () => {
		const { scene: s, handler: h } = setup()
		h.start(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		expect(s.ctx._pinching).toBe(true)
		s.dispatched.length = 0

		h.stop(new MouseEvent('mouseup'))
		expect(s.ctx._pinching).toBe(false)
		expect(s.ctx._panning).toBe(false)
		expect(s.dispatched.map((d) => d.type)).toEqual(['pinchend'])
	})
})
