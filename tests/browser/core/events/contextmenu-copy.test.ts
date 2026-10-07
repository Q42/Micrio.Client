import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContextMenuCopyHandler } from '$core/events/contextmenu-copy'
import { makeEventScene, pointer, type EventScene } from './event-fixture'

/**
 * `ContextMenuCopyHandler`: shrink the canvas to the image area on a right mouse
 * down (so the browser's native "Copy image" grabs only the image), then restore
 * the canvas and the saved camera view on the next interaction.
 *
 * The handler is inert unless the element opts in with both
 * `data-contextmenu-crop` and `data-preserve-drawing-buffer`, so each test sets up
 * exactly the precondition it needs.
 */

let scene: EventScene | undefined
let handler: ContextMenuCopyHandler | undefined

const crop = { left: 10, top: 20, width: 100, height: 80, view: [0.1, 0.2, 0.3, 0.4] as number[] }

function setup(): { scene: EventScene; handler: ContextMenuCopyHandler } {
	scene = makeEventScene()
	handler = new ContextMenuCopyHandler(scene.ctx)
	return { scene, handler }
}

/** The full opt-in precondition for engaging the crop. */
function enable(s: EventScene): void {
	s.micrio.dataset.contextmenuCrop = ''
	s.micrio.dataset.preserveDrawingBuffer = ''
	;(s.micrio as unknown as { $current?: unknown }).$current = s.image
	s.canvas._imageCrop = vi.fn(() => crop)
}

/** The saved view is whatever `getView` returned at engage time. */
function savedView(): number[] {
	return [0, 0, 1, 1]
}

afterEach(() => {
	handler?.unhook()
	scene?.destroy()
	handler = undefined
	scene = undefined
	vi.restoreAllMocks()
})

describe('ContextMenuCopyHandler — hooking', () => {
	it('hooks and unhooks idempotently', () => {
		const { handler: h } = setup()
		h.hook()
		h.hook()
		h.unhook()
		h.unhook()
		// Nothing to restore: a second unhook must not touch the canvas
		expect(scene?.canvas._exitCropMode).not.toHaveBeenCalled()
	})
})

describe('ContextMenuCopyHandler — engage', () => {
	it('crops the canvas to the image area on a right mouse down', () => {
		const { scene: s, handler: h } = setup()
		enable(s)
		h.hook()

		s.el.dispatchEvent(pointer('pointerdown', { button: 2, clientX: 100, clientY: 100 }))
		expect(s.canvas._imageCrop).toHaveBeenCalled()
		expect(s.canvas._enterCropMode).toHaveBeenCalledWith(crop)
		expect(s.image?.camera.setView).toHaveBeenCalledWith(crop.view, { noRender: true })
		expect(s.image?.camera.getView).toHaveBeenCalled()
		expect(s.drawSync).toHaveBeenCalled()
	})

	it('ignores any button but the right one', () => {
		const { scene: s, handler: h } = setup()
		enable(s)
		h.hook()
		for (const button of [0, 1]) {
			s.el.dispatchEvent(pointer('pointerdown', { button, clientX: 100, clientY: 100 }))
		}
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()
	})

	it('requires both opt-in attributes', () => {
		const { scene: s, handler: h } = setup()
		h.hook()

		// Neither attribute
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()

		// Only the crop attribute
		s.micrio.dataset.contextmenuCrop = ''
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()

		// Only the preserve attribute
		delete s.micrio.dataset.contextmenuCrop
		s.micrio.dataset.preserveDrawingBuffer = ''
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()
	})

	it('requires a ready engine with a GL context', () => {
		const { scene: s, handler: h } = setup()
		enable(s)
		h.hook()

		;(s.micrio as unknown as { _engine: { ready: boolean } })._engine.ready = false
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()

		;(s.micrio as unknown as { _engine: { ready: boolean } })._engine.ready = true
		;(s.micrio as unknown as { _webgl: { gl: unknown } })._webgl.gl = null
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()
	})

	it('skips a missing or non-2D image', () => {
		const { scene: s, handler: h } = setup()
		enable(s)
		h.hook()

		;(s.micrio as unknown as { $current?: unknown }).$current = undefined
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()

		for (const flag of ['_is360', '_isOmni', '_noImage'] as const) {
			const { image } = s
			if (!image) {
				throw new Error('no image')
			}
			image[flag] = true
			;(s.micrio as unknown as { $current?: unknown }).$current = image
			s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
			expect(s.canvas._enterCropMode).not.toHaveBeenCalled()
			image[flag] = false
		}
	})

	it('does nothing when the image already fills the canvas', () => {
		const { scene: s, handler: h } = setup()
		enable(s)
		s.canvas._imageCrop = vi.fn()
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).not.toHaveBeenCalled()
	})
})

describe('ContextMenuCopyHandler — restore', () => {
	it('restores the canvas and the view on the next interaction', () => {
		const { scene: s, handler: h } = setup()
		enable(s)
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		expect(s.canvas._enterCropMode).toHaveBeenCalled()

		s.image?.camera.setView.mockClear()
		s.drawSync.mockClear()
		document.dispatchEvent(new Event('keydown'))
		expect(s.canvas._exitCropMode).toHaveBeenCalledTimes(1)
		expect(s.image?.camera.setView).toHaveBeenCalledWith(savedView(), { noRender: true })
		expect(s.drawSync).toHaveBeenCalledTimes(1)

		// A second restore is a no-op
		document.dispatchEvent(new Event('keydown'))
		expect(s.canvas._exitCropMode).toHaveBeenCalledTimes(1)
	})

	it('restores on every documented interaction and on resize', () => {
		for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart', 'scroll']) {
			const { scene: s, handler: h } = setup()
			enable(s)
			h.hook()
			s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
			document.dispatchEvent(new Event(type))
			expect(s.canvas._exitCropMode, type).toHaveBeenCalledTimes(1)
			h.unhook()
			s.destroy()
		}

		const { scene: s, handler: h } = setup()
		enable(s)
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		globalThis.dispatchEvent(new Event('resize'))
		expect(s.canvas._exitCropMode).toHaveBeenCalledTimes(1)
	})

	it('restores when the handler is unhooked', () => {
		const { scene: s, handler: h } = setup()
		enable(s)
		h.hook()
		s.el.dispatchEvent(pointer('pointerdown', { button: 2 }))
		h.unhook()
		expect(s.canvas._exitCropMode).toHaveBeenCalledTimes(1)
	})

	it('is safe to call with nothing engaged', () => {
		const { scene: s, handler: h } = setup()
		h.restore()
		expect(s.canvas._exitCropMode).not.toHaveBeenCalled()
		expect(s.drawSync).not.toHaveBeenCalled()
	})
})
