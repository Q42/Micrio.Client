import { afterEach, describe, expect, it, vi } from 'vitest'

import { GestureHandler } from '$core/events/gesture'
import { gesture, makeEventScene, stubBrowser, type EventScene } from './event-fixture'

/**
 * `GestureHandler` — the macOS trackpad `gesturestart`/`gesturechange`/`gestureend`
 * events, which arrive with a `scale` field but are not a DOM event class.
 *
 * Only attached on macOS, and only `gesturechange` actually zooms: the start/end
 * events are consumed (propagation stopped, default prevented) but otherwise ignored.
 */

let scene: EventScene | undefined
let handler: GestureHandler | undefined

function setup(): { scene: EventScene; handler: GestureHandler } {
	scene = makeEventScene()
	handler = new GestureHandler(scene.ctx)
	return { scene, handler }
}

afterEach(() => {
	handler?.unhook()
	scene?.destroy()
	handler = undefined
	scene = undefined
	vi.restoreAllMocks()
})

describe('GestureHandler — hooking', () => {
	it('hooks only on macOS, and unhooks again', () => {
		const { scene: s, handler: h } = setup()

		// Not macOS: the listener is never attached
		h.hook()
		s.el.dispatchEvent(gesture('gesturechange', { scale: 1.5, clientX: 10, clientY: 10 }))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()

		const restore = stubBrowser({ OSX: true })
		try {
			h.hook()
			s.el.dispatchEvent(gesture('gesturechange', { scale: 1.5, clientX: 10, clientY: 10 }))
			expect(s.image?.camera.zoom).toHaveBeenCalled()

			h.unhook()
			s.image?.camera.zoom.mockClear()
			s.el.dispatchEvent(gesture('gesturechange', { scale: 2, clientX: 10, clientY: 10 }))
			expect(s.image?.camera.zoom).not.toHaveBeenCalled()
		} finally {
			restore()
		}
	})
})

describe('GestureHandler — event sniffing', () => {
	it('ignores an event without a numeric scale and position', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()

			s.el.dispatchEvent(new Event('gesturechange', { bubbles: true, cancelable: true }))
			s.el.dispatchEvent(Object.assign(new Event('gesturechange', { bubbles: true, cancelable: true }), { scale: 2 }))
			s.el.dispatchEvent(
				Object.assign(new Event('gesturechange', { bubbles: true, cancelable: true }), {
					scale: 'wide',
					clientX: 1,
					clientY: 1,
				}),
			)

			expect(s.image?.camera.zoom).not.toHaveBeenCalled()
			expect(s.ctx._pScale).toBe(1)
		} finally {
			restore()
		}
	})

	it('resets the scale baseline on a scale of 1', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()
			s.ctx._pScale = 3

			const ev = gesture('gesturechange', { scale: 1, clientX: 10, clientY: 10 })
			s.el.dispatchEvent(ev)
			expect(s.ctx._pScale).toBe(1)
			expect(s.image?.camera.zoom).not.toHaveBeenCalled()
			expect(ev.defaultPrevented).toBe(false)
		} finally {
			restore()
		}
	})

	it('ignores a gesture that started outside the canvas', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()
			const other = document.createElement('div')
			s.micrio.append(other)

			const ev = gesture('gesturechange', { scale: 1.5, clientX: 10, clientY: 10 })
			other.dispatchEvent(ev)
			expect(s.ctx._pScale).toBe(1)
			expect(s.image?.camera.zoom).not.toHaveBeenCalled()
			expect(ev.defaultPrevented).toBe(false)
		} finally {
			restore()
		}
	})
})

describe('GestureHandler — handling', () => {
	it('zooms by the scale delta times the viewport height', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()

			const ev = gesture('gesturechange', { scale: 1.5, clientX: 120, clientY: 90 })
			s.el.dispatchEvent(ev)
			expect(s.image?.camera.zoom).toHaveBeenCalledWith(-300, 0, 120, 90)
			expect(ev.defaultPrevented).toBe(true)
			expect(s.ctx._pScale).toBe(1.5)

			// The next change is relative to the previous scale
			s.el.dispatchEvent(gesture('gesturechange', { scale: 2, clientX: 120, clientY: 90 }))
			expect(s.image?.camera.zoom).toHaveBeenLastCalledWith(-300, 0, 120, 90)
			expect(s.ctx._pScale).toBe(2)
		} finally {
			restore()
		}
	})

	it('anchors the zoom on the element-relative point', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const offset = makeEventScene({ left: 100, top: 50 })
			const h = new GestureHandler(offset.ctx)
			h.hook()
			offset.el.dispatchEvent(gesture('gesturechange', { scale: 1.5, clientX: 300, clientY: 200 }))
			expect(offset.image?.camera.zoom).toHaveBeenCalledWith(-300, 0, 200, 150)
			offset.destroy()
		} finally {
			restore()
		}
	})

	it('consumes the start and end events without zooming', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()

			for (const type of ['gesturestart', 'gestureend']) {
				const ev = gesture(type, { scale: 1.5, clientX: 10, clientY: 10 })
				s.el.dispatchEvent(ev)
				expect(ev.defaultPrevented).toBe(true)
			}
			expect(s.image?.camera.zoom).not.toHaveBeenCalled()
			expect(s.ctx._pScale).toBe(1.5)
		} finally {
			restore()
		}
	})

	it('tolerates a gesture with no image under it', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()
			s.image = undefined
			const ev = gesture('gesturechange', { scale: 2, clientX: 10, clientY: 10 })
			expect(() => {
				s.el.dispatchEvent(ev)
			}).not.toThrow()
			expect(s.ctx._pScale).toBe(2)
		} finally {
			restore()
		}
	})
})
