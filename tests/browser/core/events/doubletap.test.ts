import { afterEach, describe, expect, it, vi } from 'vitest'

import { DoubleTapHandler } from '$core/events/doubletap'
import { makeEventScene, makeImage, stubBrowser, touch, touchEvent, type EventScene } from './event-fixture'

/**
 * `DoubleTapHandler`: the touch double-tap and the desktop double-click.
 *
 * `hookTap`/`hookClick` are mutually exclusive in the wild (`hookZoom` picks one
 * from `canvas.$isMobile`), so they are exercised separately. The 250 ms window is
 * driven through the public `_vars._dbltap._lastTapped` rather than by waiting.
 */

let scene: EventScene | undefined
let handler: DoubleTapHandler | undefined

function setup(): { scene: EventScene; handler: DoubleTapHandler } {
	scene = makeEventScene()
	handler = new DoubleTapHandler(scene.ctx)
	return { scene, handler }
}

afterEach(() => {
	handler?.unhookTap()
	handler?.unhookClick()
	scene?.destroy()
	handler = undefined
	scene = undefined
	vi.restoreAllMocks()
})

describe('DoubleTapHandler — taps', () => {
	it('zooms on a second tap inside the 250 ms window', () => {
		const { scene: s, handler: h } = setup()
		h.hookTap()

		s.ctx._vars._dbltap._lastTapped = performance.now() - 1000
		s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 100, 80, s.el)]))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()

		const second = touchEvent('touchstart', [touch(1, 100, 80, s.el)])
		s.el.dispatchEvent(second)
		expect(s.image?.camera.zoom).toHaveBeenCalledWith(-300, 500, 100, 80, 1, true)
		expect(second.defaultPrevented).toBe(true)
	})

	it('records a tap without one finger', () => {
		const { scene: s, handler: h } = setup()
		h.hookTap()
		s.ctx._vars._dbltap._lastTapped = performance.now() - 1000

		s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 0, 0, s.el), touch(2, 40, 0, s.el)]))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
		expect(s.ctx._vars._dbltap._lastTapped).toBeGreaterThan(0)
	})

	it('ignores a non-TouchEvent and a browser without touch', () => {
		const { scene: s, handler: h } = setup()
		h.hookTap()
		s.el.dispatchEvent(new Event('touchstart'))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()

		const restore = stubBrowser({ hasTouch: false })
		try {
			s.ctx._vars._dbltap._lastTapped = performance.now()
			s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 10, 10, s.el)]))
			expect(s.image?.camera.zoom).not.toHaveBeenCalled()
		} finally {
			restore()
		}
	})

	it('stops listening once the tap hook is removed', () => {
		const { scene: s, handler: h } = setup()
		h.hookTap()
		h.unhookTap()
		s.ctx._vars._dbltap._lastTapped = performance.now()
		s.el.dispatchEvent(touchEvent('touchstart', [touch(1, 10, 10, s.el)]))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})
})

describe('DoubleTapHandler — clicks', () => {
	it('zooms on a double-click, without limit when there is no album', () => {
		const { scene: s, handler: h } = setup()
		h.hookClick()
		s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 50, clientY: 60, bubbles: true }))
		expect(s.image?.camera.zoom).toHaveBeenCalledWith(-300, 500, 50, 60, 1, true)
	})

	it('keeps the zoom limited inside an album', () => {
		const { scene: s, handler: h } = setup()
		h.hookClick()
		;(s.micrio as unknown as { $current?: unknown }).$current = { album: {} }
		s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 50, clientY: 60, bubbles: true }))
		expect(s.image?.camera.zoom).toHaveBeenCalledWith(-300, 500, 50, 60, 1, false)
	})

	it('anchors the zoom on the element-relative point', () => {
		// `zoom` works in element-relative CSS pixels, so an offset host shifts the anchor.
		const offset = makeEventScene({ left: 100, top: 50 })
		const h = new DoubleTapHandler(offset.ctx)
		h.hookClick()
		offset.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 200, bubbles: true }))
		expect(offset.image?.camera.zoom).toHaveBeenCalledWith(-300, 500, 200, 150, 1, true)
		offset.destroy()
	})

	it('does nothing without an image and after unhooking', () => {
		const { scene: s, handler: h } = setup()
		h.hookClick()
		s.image = undefined
		expect(() => {
			s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }))
		}).not.toThrow()

		s.image = makeImage({ camera: s.camera })
		h.unhookClick()
		s.el.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }))
		expect(s.image.camera.zoom).not.toHaveBeenCalled()
	})
})
