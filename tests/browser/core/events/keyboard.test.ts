import { afterEach, describe, expect, it, vi } from 'vitest'

import { KeyboardHandler } from '$core/events/keyboard'
import { Grid } from '$grid/grid'
import { makeEventScene, type EventScene } from './event-fixture'

/**
 * `KeyboardHandler`: arrow-key panning and `+`/`-` zooming, bound on `document`
 * so the viewer keeps the keys while focus is anywhere on the page.
 *
 * The grid gets first refusal: while `Grid._handlingKeys` is set, the navigation
 * keys are left for the grid's own handler.
 */

let scene: EventScene | undefined
let handler: KeyboardHandler | undefined

function setup(): { scene: EventScene; handler: KeyboardHandler } {
	scene = makeEventScene()
	handler = new KeyboardHandler(scene.ctx)
	handler.hook()
	// The handler needs a current camera; the default scene has none.
	;(scene.micrio as unknown as { $current?: unknown }).$current = scene.image
	return { scene, handler }
}

function key(type: string, init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
}

afterEach(() => {
	handler?.unhook()
	scene?.destroy()
	Grid._handlingKeys = false
	handler = undefined
	scene = undefined
	vi.restoreAllMocks()
})

describe('KeyboardHandler — hooking', () => {
	it('hooks and unhooks on the document', () => {
		const { scene: s, handler: h } = setup()
		h.unhook()

		document.dispatchEvent(key('keydown', { key: 'ArrowRight' }))
		expect(s.image?.camera.pan).not.toHaveBeenCalled()

		h.hook()
		document.dispatchEvent(key('keydown', { key: 'ArrowRight' }))
		expect(s.image?.camera.pan).toHaveBeenCalledWith(400, 0, 150)
	})
})

describe('KeyboardHandler — guards', () => {
	it('does nothing without a current camera', () => {
		const { scene: s } = setup()
		;(s.micrio as unknown as { $current?: unknown }).$current = undefined
		document.dispatchEvent(key('keydown', { key: 'ArrowRight' }))
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
	})

	it('does nothing while panning or pinching', () => {
		const { scene: s } = setup()
		s.ctx._panning = true
		document.dispatchEvent(key('keydown', { key: 'ArrowRight' }))
		expect(s.image?.camera.pan).not.toHaveBeenCalled()

		s.ctx._panning = false
		s.ctx._pinching = true
		document.dispatchEvent(key('keydown', { key: 'ArrowRight' }))
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
	})

	it('yields the navigation keys to a grid that is handling them', () => {
		const { scene: s } = setup()
		Grid._handlingKeys = true
		for (const k of ['ArrowRight', 'Enter', ' ', 'Escape']) {
			document.dispatchEvent(key('keydown', { key: k }))
		}
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()

		// A non-navigation key is not the grid's and falls through to the default no-op
		document.dispatchEvent(key('keydown', { key: 'a' }))
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})
})

describe('KeyboardHandler — arrows', () => {
	it('pans by half the element size in every direction', () => {
		const { scene: s } = setup()
		for (const [k, x, y] of [
			['ArrowRight', 400, 0],
			['ArrowLeft', -400, 0],
			['ArrowDown', 0, 300],
			['ArrowUp', 0, -300],
		] as const) {
			document.dispatchEvent(key('keydown', { key: k }))
			expect(s.image?.camera.pan).toHaveBeenLastCalledWith(x, y, 150)
		}
	})

	it('cancels the arrow event', () => {
		setup()
		const ev = key('keydown', { key: 'ArrowUp' })
		document.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(true)
	})

	it('leaves an unknown key alone', () => {
		const { scene: s } = setup()
		const ev = key('keydown', { key: 'a' })
		document.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(false)
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
		expect(s.image?.camera.zoom).not.toHaveBeenCalled()
	})
})

describe('KeyboardHandler — zoom keys', () => {
	it('zooms in on + and =, out on - and _', () => {
		const { scene: s } = setup()
		for (const k of ['+', '=']) {
			s.image?.camera.zoom.mockClear()
			document.dispatchEvent(key('keydown', { key: k }))
			expect(s.image?.camera.zoom).toHaveBeenCalledWith(-200, 150)
		}
		for (const k of ['-', '_']) {
			s.image?.camera.zoom.mockClear()
			document.dispatchEvent(key('keydown', { key: k }))
			expect(s.image?.camera.zoom).toHaveBeenCalledWith(200, 150)
		}
		// A zoom key never pans
		expect(s.image?.camera.pan).not.toHaveBeenCalled()
	})

	it('swallows a rejected zoom promise', async () => {
		const { scene: s } = setup()
		s.image?.camera.zoom.mockRejectedValue(new Error('zoom refused'))
		document.dispatchEvent(key('keydown', { key: '+' }))
		document.dispatchEvent(key('keydown', { key: '-' }))
		// Let the attached `.catch` handlers run; an unhandled rejection would fail the run
		await Promise.resolve()
		await Promise.resolve()
		expect(s.image?.camera.zoom).toHaveBeenCalledTimes(2)
	})
})
