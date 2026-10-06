import { afterEach, describe, expect, it, vi } from 'vitest'

import { WheelHandler } from '$core/events/wheel'
import { makeEventScene, stubBrowser, stubDpr, type EventScene } from './event-fixture'

/**
 * `WheelHandler`: wheel zoom vs trackpad pan, the Ctrl/Cmd gate, and the anchor
 * it hands to the camera.
 *
 * The anchor is the retina seam: the handler turns a client position into
 * canvas-relative CSS pixels (`coo − offX − box.left`) and never touches the
 * device pixel ratio. `stubDpr` proves the value survives a DPR change.
 */

let scene: EventScene | undefined
let handler: WheelHandler | undefined

function setup(opts: Parameters<typeof makeEventScene>[0] = {}): { scene: EventScene; handler: WheelHandler } {
	scene = makeEventScene(opts)
	handler = new WheelHandler(scene.ctx)
	return { scene, handler }
}

afterEach(() => {
	handler?.unhook()
	scene?.destroy()
	handler = undefined
	scene = undefined
	vi.useRealTimers()
	vi.restoreAllMocks()
})

function wheel(init: WheelEventInit = {}): WheelEvent {
	return new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
}

describe('WheelHandler — hooking', () => {
	it('hooks and unhooks idempotently', () => {
		const { handler: h } = setup()
		expect(h.hooked).toBe(false)
		h.hook()
		h.hook()
		expect(h.hooked).toBe(true)
		h.unhook()
		h.unhook()
		expect(h.hooked).toBe(false)
	})
})

describe('WheelHandler — target filtering', () => {
	it('ignores a foreign target', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		const other = document.createElement('div')
		s.micrio.append(other)
		const ev = wheel({ deltaY: 100, clientX: 10, clientY: 10 })
		other.dispatchEvent(ev)
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
		expect(ev.defaultPrevented).toBe(false)
	})

	it('accepts a marker and a scroll-through target', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		const marker = document.createElement('div')
		marker.classList.add('marker')
		const through = document.createElement('div')
		through.dataset.scrollThrough = ''
		s.micrio.append(marker, through)

		marker.dispatchEvent(wheel({ deltaY: 100, clientX: 10, clientY: 10 }))
		through.dispatchEvent(wheel({ deltaY: 100, clientX: 10, clientY: 10 }))
		expect(s.image?.camera.zoom).toHaveBeenCalledTimes(2)
	})

	it('ignores a non-WheelEvent', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		h.handle(new Event('wheel'))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})
})

describe('WheelHandler — zoom vs pan', () => {
	it('zooms by delta over the square root of the viewport scale', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.canvas.viewport.scale = 4
		const ev = wheel({ deltaY: -80, clientX: 300, clientY: 200 })
		s.el.dispatchEvent(ev)
		expect(s.image?.camera.zoom).toHaveBeenCalledWith(-40, 0, 300, 200)
		expect(ev.defaultPrevented).toBe(true)
	})

	it('pans once a Ctrl-modified wheel has marked the device as a trackpad', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		// A Ctrl+wheel is the marker; it zooms and sets `_hasUsedCtrl`
		s.el.dispatchEvent(wheel({ deltaY: 100, deltaX: 5, ctrlKey: true, clientX: 10, clientY: 10 }))
		expect(s.ctx._hasUsedCtrl).toBe(true)
		expect(s.image?.camera.zoom).toHaveBeenCalled()

		// The next plain wheel pans both axes
		s.image?.camera.pan.mockClear()
		s.el.dispatchEvent(wheel({ deltaY: 30, deltaX: 12, clientX: 10, clientY: 10 }))
		expect(s.image?.camera.pan).toHaveBeenCalledWith(12, 30)
	})

	it('lets Firefox zoom even on a trackpad-like device', () => {
		const restore = stubBrowser({ firefox: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()
			s.ctx._hasUsedCtrl = true
			s.el.dispatchEvent(wheel({ deltaY: 10, clientX: 10, clientY: 10 }))
			expect(s.image?.camera.zoom).toHaveBeenCalled()
			expect(s.image?.camera.pan).not.toHaveBeenCalled()
		} finally {
			restore()
		}
	})

	it('distinguishes a control-zoom mouse wheel from a trackpad', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.ctx._controlZoom = true

		// An integral delta reads as a mouse wheel: the delta passes through unscaled
		s.el.dispatchEvent(wheel({ deltaY: 20, ctrlKey: true, clientX: 10, clientY: 10 }))
		expect(s.image?.camera.zoom).toHaveBeenCalledWith(20, 0, 10, 10)

		// A fractional one reads as a trackpad: the delta is scaled by 10
		s.el.dispatchEvent(wheel({ deltaY: 10.05, ctrlKey: true, clientX: 10, clientY: 10 }))
		expect(s.image?.camera.zoom).toHaveBeenLastCalledWith(100.5, 0, 10, 10)
	})
})

describe('WheelHandler — Ctrl/Cmd gate', () => {
	it('ignores a wheel without Ctrl when controlZoom is on', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.ctx._controlZoom = true
		const ev = wheel({ deltaY: 100, clientX: 10, clientY: 10 })
		s.el.dispatchEvent(ev)
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
		expect(ev.defaultPrevented).toBe(false)
	})

	it('zooms with Ctrl when controlZoom is on', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.ctx._controlZoom = true
		s.el.dispatchEvent(wheel({ deltaY: 100, ctrlKey: true, clientX: 10, clientY: 10 }))
		expect(s.image?.camera.zoom).toHaveBeenCalled()
	})

	it('scales the delta by 10 for a Mac Ctrl-wheel', () => {
		const restore = stubBrowser({ OSX: true })
		try {
			const { scene: s, handler: h } = setup()
			h.hook()
			s.el.dispatchEvent(wheel({ deltaY: 3, ctrlKey: true, clientX: 10, clientY: 10 }))
			expect(s.image?.camera.zoom).toHaveBeenCalledWith(30, 0, 10, 10)
		} finally {
			restore()
		}
	})
})

describe('WheelHandler — guard rails', () => {
	it('lets a two-finger pan through at the fully zoomed-out view', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.ctx._twoFingerPan = true
		;(s.micrio as unknown as { $current?: unknown }).$current = s.image
		s.camera._zoomedOut = true

		const ev = wheel({ deltaY: 100, clientX: 10, clientY: 10 })
		s.el.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(false)
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})

	it('cancels the event but does nothing without an image', () => {
		const { scene: s, handler: h } = setup()
		h.hook()
		s.image = undefined
		const ev = wheel({ deltaY: 100, clientX: 10, clientY: 10 })
		s.el.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(true)
	})
})

describe('WheelHandler — coordinate anchor', () => {
	it('makes the anchor canvas-relative for an offset host', () => {
		const { scene: s, handler: h } = setup({ left: 120, top: 80 })
		h.hook()
		s.el.dispatchEvent(wheel({ deltaY: 50, clientX: 400, clientY: 300 }))
		expect(s.image?.camera.zoom).toHaveBeenCalledWith(50, 0, 280, 220)
	})

	it('subtracts the caller offset from the anchor', () => {
		const { scene: s, handler: h } = setup({ left: 120, top: 80 })
		h.hook()
		h.handle(wheel({ deltaY: 50, clientX: 400, clientY: 300 }), false, 25)
		expect(s.image?.camera.zoom).toHaveBeenCalledWith(50, 0, 255, 220)
	})

	it('hands the same CSS-pixel anchor to the camera at any device pixel ratio', () => {
		const { scene: s, handler: h } = setup({ left: 40, top: 20 })
		h.hook()

		s.el.dispatchEvent(wheel({ deltaY: 50, clientX: 300, clientY: 240 }))
		const atOne = s.image?.camera.zoom.mock.calls.at(-1)

		const restoreDpr = stubDpr(s, 2)
		try {
			s.el.dispatchEvent(wheel({ deltaY: 50, clientX: 300, clientY: 240 }))
			const atTwo = s.image?.camera.zoom.mock.calls.at(-1)
			// viewport.scale is unchanged, so the whole call is identical
			expect(atTwo).toEqual(atOne)
			expect(atTwo?.slice(2)).toEqual([260, 220])
		} finally {
			restoreDpr()
		}
	})
})

describe('WheelHandler — wheeling state', () => {
	it('clears the wheeling flag after the debounce', () => {
		vi.useFakeTimers()
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(wheel({ deltaY: 100, clientX: 10, clientY: 10 }))
		expect(s.ctx._wheeling).toBe(true)

		vi.advanceTimersByTime(50)
		expect(s.ctx._wheeling).toBe(false)
	})

	it('restarts the debounce on a second wheel', () => {
		vi.useFakeTimers()
		const { scene: s, handler: h } = setup()
		h.hook()
		s.el.dispatchEvent(wheel({ deltaY: 100, clientX: 10, clientY: 10 }))
		vi.advanceTimersByTime(40)
		s.el.dispatchEvent(wheel({ deltaY: 100, clientX: 10, clientY: 10 }))
		vi.advanceTimersByTime(40)
		// The first timer was cleared; the second has not fired yet
		expect(s.ctx._wheeling).toBe(true)
		vi.advanceTimersByTime(10)
		expect(s.ctx._wheeling).toBe(false)
	})
})
