import { afterEach, describe, expect, it, vi } from 'vitest'

import { Events } from '$core/events/facade'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import {
	makeEventScene,
	makeImage,
	pointer,
	stubBrowser,
	touch,
	touchEvent,
	type EventScene,
	type FakeImage,
} from './event-fixture'

/**
 * The `Events` facade: settings-driven hooking, the image under a point, and the
 * custom-event bridge.
 *
 * `#settings` is captured once from the first truthy `current`, so every case that
 * changes settings gets a fresh scene. The private handler instances are not
 * reachable from here; the wiring is observed through the DOM (`dataset`, spies on
 * `addEventListener`) and through the stores.
 */

let scene: EventScene | undefined
let events: Events | undefined

function facade(settings?: Partial<Models.ImageInfo.Settings>): { scene: EventScene; events: Events } {
	scene = makeEventScene()
	events = new Events(scene.micrio)
	if (settings) {
		scene.current.set({ $settings: settings, error: false } as unknown as MicrioImage)
	}
	return { scene, events }
}

function asImage(image: FakeImage): MicrioImage {
	return image as unknown as MicrioImage
}

afterEach(() => {
	events?.unhook()
	scene?.destroy()
	events = undefined
	scene = undefined
	vi.restoreAllMocks()
})

describe('Events — navigating state', () => {
	it('is navigating while panning, pinching or wheeling', () => {
		const { events: e } = facade()
		expect(e.isNavigating).toBe(false)
		for (const flag of ['_panning', '_pinching', '_wheeling'] as const) {
			e[flag] = true
			expect(e.isNavigating).toBe(true)
			e[flag] = false
		}
		expect(e.isNavigating).toBe(false)
	})
})

describe('Events — dispatching', () => {
	it('bridges to a CustomEvent with and without detail', () => {
		const { scene: s, events: e } = facade()
		const seen: unknown[] = []
		s.micrio.addEventListener('panend', (ev) => seen.push((ev as CustomEvent).detail))
		s.micrio.addEventListener('pinchstart', (ev) => seen.push((ev as CustomEvent).detail))

		e._dispatch('panend', { duration: 1, movedX: 2, movedY: 3 })
		e._dispatch('pinchstart')
		expect(seen).toEqual([{ duration: 1, movedX: 2, movedY: 3 }, null])
	})
})

describe('Events — image under a point', () => {
	it('returns the single visible candidate', () => {
		const { scene: s, events: e } = facade()
		const image = asImage(makeImage())
		s.visible.set([image])
		expect(e._getImage({ x: 10, y: 10 })).toBe(image)
		expect(e._getVisible()).toEqual([image])
	})

	it('filters hidden and passive-secondary images', () => {
		const { scene: s, events: e } = facade()
		const hidden = asImage(makeImage({ _noImage: true }))
		const passive = asImage(makeImage({ _isPassiveSecondary: true }))
		const shown = asImage(makeImage())
		s.visible.set([hidden, passive, shown])
		expect(e._getImage({ x: 10, y: 10 })).toBe(shown)
	})

	it('picks the area a point falls in, clamped to the element', () => {
		const { scene: s, events: e } = facade()
		const topLeft = asImage(makeImage({ id: 'tl' }))
		topLeft.opts.area = [0, 0, 0.5, 0.5]
		const bottomRight = asImage(makeImage({ id: 'br' }))
		bottomRight.opts.area = [0.5, 0.5, 0.5, 0.5]
		s.visible.set([topLeft, bottomRight])

		expect(e._getImage({ x: 100, y: 100 })).toBe(topLeft)
		expect(e._getImage({ x: 700, y: 500 })).toBe(bottomRight)
		// A negative point clamps to the element's origin, so it still matches the first area
		expect(e._getImage({ x: -100, y: -100 })).toBe(topLeft)
	})

	it('falls back to the current image when nothing matches', () => {
		const { scene: s, events: e } = facade()
		const left = asImage(makeImage({ id: 'left' }))
		left.opts.area = [0, 0, 0.1, 0.1]
		const right = asImage(makeImage({ id: 'right' }))
		right.opts.area = [0.9, 0.9, 0.1, 0.1]
		const current = asImage(makeImage({ id: 'current' }))
		s.visible.set([left, right])
		;(s.micrio as unknown as { $current?: unknown }).$current = current

		// The centre is inside neither area
		expect(e._getImage({ x: 400, y: 300 })).toBe(current)
	})

	it('never routes to a grid candidate, and lets a grid controller resolve', () => {
		const { scene: s, events: e } = facade()
		const gridImage = asImage(makeImage({ id: 'grid-image', grid: { _getImageAt: vi.fn() } }))
		const current = asImage(makeImage({ id: 'current' }))
		;(s.micrio as unknown as { $current?: unknown }).$current = current

		// A visible candidate that carries a grid is not returned directly
		s.visible.set([gridImage])
		expect(e._getImage({ x: 10, y: 10 })).toBe(current)

		// A grid controller on the element answers first
		const hit = asImage(makeImage({ id: 'hit' }))
		const control = { grid: { _getImageAt: vi.fn<() => MicrioImage | undefined>() } }
		;(s.micrio as unknown as { _canvases: unknown[] })._canvases.push(control)
		control.grid._getImageAt.mockReturnValue(hit)
		expect(e._getImage({ x: 10, y: 10 })).toBe(hit)

		// And falls back to the current image when it has no hit
		control.grid._getImageAt.mockReset()
		expect(e._getImage({ x: 10, y: 10 })).toBe(current)
	})
})

describe('Events — hooking settings', () => {
	it('does nothing when no image has supplied settings yet', () => {
		const { events: e } = facade()
		expect(() => {
			e.hook()
		}).not.toThrow()
		expect(e.scrollHooked).toBe(false)

		// `hook` marks itself hooked before the settings check, so `unhook` still cleans up
		expect(() => {
			e.unhook()
		}).not.toThrow()
	})

	it('applies drag, keys and two-finger pan from the settings', () => {
		const { scene: s, events: e } = facade({
			hookDrag: true,
			hookKeys: true,
			twoFingerPan: true,
		})
		const camera = s.image?.camera
		if (!camera) {
			throw new Error('no fake camera')
		}
		;(s.micrio as unknown as { $current?: unknown }).$current = { camera }
		e.hook()
		e.hook()

		expect(s.micrio.dataset.hooked).toBe('')
		expect(s.micrio.dataset.canPan).toBe('')
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
		expect(camera.pan).toHaveBeenCalledWith(400, 0, 150)

		e.unhook()
		expect(s.micrio.dataset.hooked).toBeUndefined()
	})

	it('omni keys can be left to the host page', () => {
		const { scene: s, events: e } = facade({ hookKeys: true, omni: { noKeys: true } as never })
		const { camera } = makeImage()
		;(s.micrio as unknown as { $current?: unknown }).$current = { camera }
		e.hook()
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
		expect(camera.pan).not.toHaveBeenCalled()
	})

	it('noZoom skips the whole zoom layer', () => {
		const { scene: s, events: e } = facade({ noZoom: true })
		;(s.micrio as unknown as { $current?: unknown }).$current = makeImage()
		e.hook()
		expect(e.scrollHooked).toBe(false)

		s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})

	it('controlZoom still hooks the wheel when hookScroll is off', () => {
		const { events: e } = facade({ controlZoom: true, hookScroll: false })
		e.hook()
		expect(e.scrollHooked).toBe(true)
	})

	it('hookPinch off skips the pinch layer without breaking the rest', () => {
		const { events: e } = facade({ hookPinch: false })
		expect(() => {
			e.hook()
		}).not.toThrow()
		e.unhook()
	})

	it('toggles everything through the enabled store', () => {
		const { scene: s, events: e } = facade({ hookDrag: true })
		e.enabled.set(true)
		expect(s.micrio.dataset.hooked).toBe('')
		e.enabled.set(false)
		expect(s.micrio.dataset.hooked).toBeUndefined()
		e.enabled.set(true)
		expect(s.micrio.dataset.hooked).toBe('')
	})
})

describe('Events — zoom layer on mobile', () => {
	it('routes the double gesture to touch on a mobile canvas', () => {
		const { scene: s, events: e } = facade({})
		;(s.micrio as unknown as { $current?: unknown }).$current = s.image
		s.canvas.isMobile.set(true)
		e.hook()

		// A double-tap zooms; the double-click is not hooked
		s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()

		e._vars._dbltap._lastTapped = performance.now()
		s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 40, 40, s.el)]))
		expect(s.image?.camera.zoom).toHaveBeenCalled()

		// Unhooking removes the touch handler again
		s.image?.camera.zoom.mockClear()
		e.unhookZoom()
		e._vars._dbltap._lastTapped = performance.now()
		s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 40, 40, s.el)]))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})

	it('routes the double gesture to the mouse on a desktop canvas', () => {
		const { scene: s, events: e } = facade({})
		;(s.micrio as unknown as { $current?: unknown }).$current = s.image
		e.hook()
		s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }))
		expect(s.image?.camera.zoom).toHaveBeenCalled()

		s.image?.camera.zoom.mockClear()
		e.unhookZoom()
		s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})
})

describe('Events — pinch layer selection', () => {
	it('uses the touch pinch handler on iOS with touch', () => {
		const restore = stubBrowser({ iOS: true })
		try {
			const { scene: s, events: e } = facade()
			e._hasTouch = true
			const spy = vi.spyOn(s.micrio, 'addEventListener')
			e.hookPinch()
			const types = spy.mock.calls.map((c) => c[0])
			expect(types).toContain('touchstart')
			expect(types).not.toContain('pointerdown')

			// Unhooking removes the touch listener
			const remove = vi.spyOn(s.micrio, 'removeEventListener')
			e.unhookPinch()
			expect(remove.mock.calls.map((c) => c[0])).toContain('touchstart')
		} finally {
			restore()
		}
	})

	it('uses the pointer pinch handler elsewhere', () => {
		const restore = stubBrowser({ iOS: false })
		try {
			const { scene: s, events: e } = facade()
			const spy = vi.spyOn(s.micrio, 'addEventListener')
			e.hookPinch()
			const types = spy.mock.calls.map((c) => c[0])
			expect(types).toContain('pointerdown')
			expect(types).not.toContain('touchstart')

			const remove = vi.spyOn(s.micrio, 'removeEventListener')
			e.unhookPinch()
			expect(remove.mock.calls.map((c) => c[0])).toContain('pointerdown')
		} finally {
			restore()
		}
	})

	it('clears the active pointers on unhook', () => {
		const { events: e } = facade()
		e.hook()
		e._activePointers.set(1, { x: 0, y: 0 })
		e.unhook()
		expect(e._activePointers.size).toBe(0)
	})

	it('ends a drag in flight when unhooking', () => {
		const { scene: s, events: e } = facade({ hookDrag: true })
		e.hook()
		if (!s.image) {
			throw new Error('no fake image')
		}
		// The facade hit-tests through the visible store, not the fixture's fixed image
		s.visible.set([asImage(s.image)])
		s.el.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 31, clientX: 100, clientY: 100 }))
		expect(e._panning).toBe(true)

		// A drag's move/up listeners are only removed by `stop()`, so unhooking has to end the
		// drag: a flag left set blocks every later drag and keeps `isNavigating` true, which
		// makes the engine render every frame.
		e.unhook()
		expect(e._panning).toBe(false)
		expect(s.micrio.dataset.panning).toBeUndefined()

		s.image?.camera.pan.mockClear()
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 31, clientX: 140, clientY: 100 }))
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
	})

	it('keeps the context-menu hooks on the element', () => {
		const { scene: s, events: e } = facade()
		const spy = vi.spyOn(s.micrio, 'addEventListener')
		e.hookContextMenuCopy()
		expect(spy.mock.calls.map((c) => c[0])).toContain('pointerdown')
		e.unhookContextMenuCopy()
	})
})
