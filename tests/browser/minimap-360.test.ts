import { afterEach, describe, expect, it, vi } from 'vitest'
import { openVisibleSpace } from '../fixtures/space-fixture'
import { settle } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'

/**
 * The 360 branch of the navigation minimap.
 *
 * The canvas is deliberately *not* sampled: the thumbnail it draws over comes from a
 * cross-origin CDN, so `getImageData` would throw a security error. The observable
 * behaviour — geometry, the idle timeout, the rotation offset and dragging to move the
 * camera — is asserted instead.
 */
const minimapOf = (el: Element) => el.querySelector('micrio-minimap')
const canvasOf = (el: Element) => el.querySelector('micrio-minimap canvas')

/** Stubs the canvas geometry so a synthetic drag maps to a predictable point. */
function stubRect(canvas: Element, width: number, height: number) {
	canvas.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			width,
			height,
			right: width,
			bottom: height,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		}) as DOMRect
}

/** Clicks the map at a point given in canvas pixels. */
async function clickMap(canvas: Element, x: number, y: number, button = 0) {
	canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button, bubbles: true }))
	await settle(2)
	globalThis.dispatchEvent(new MouseEvent('mouseup'))
}

afterEach(() => {
	vi.useRealTimers()
})

describe('360 minimap', () => {
	it('is only rendered when the image has a thumbnail', async () => {
		const { viewer } = await openVisibleSpace()
		expect(minimapOf(viewer.el)).not.toBeNull()
		expect(viewer.el.$current?.thumbSrc).toBeTruthy()
		viewer.destroy()
	})

	it('sizes the canvas from the image aspect ratio', async () => {
		const { viewer } = await openVisibleSpace()
		const canvas = canvasOf(viewer.el)
		expect(canvas).toBeInstanceOf(HTMLCanvasElement)
		// The fixture is square and the default bounds are 200x160, so the smaller
		// bound wins
		expect((canvas as HTMLCanvasElement).width).toBe(160)
		expect((canvas as HTMLCanvasElement).height).toBe(160)
		viewer.destroy()
	})

	it('shows the image thumbnail as the backdrop', async () => {
		const { viewer } = await openVisibleSpace()
		const canvas = canvasOf(viewer.el) as HTMLCanvasElement
		expect(canvas.style.backgroundImage).toContain(viewer.el.$current?.thumbSrc ?? '')
		viewer.destroy()
	})

	it('offsets the backdrop by the image rotation', async () => {
		const flat = await openVisibleSpace()
		const flatCanvas = canvasOf(flat.viewer.el) as HTMLCanvasElement
		expect(flatCanvas.style.backgroundPositionX).toBe('')
		flat.viewer.destroy()

		const rotated = await openVisibleSpace(0, { rotationY: () => Math.PI / 2 })
		const rotatedCanvas = canvasOf(rotated.viewer.el) as HTMLCanvasElement
		// offset = -rotationY / 2π = -0.25, times the 160px canvas width
		expect(rotatedCanvas.style.backgroundPositionX).toBe('-40px')
		rotated.viewer.destroy()
	})

	it('hides itself again after the idle timeout', async () => {
		const { viewer } = await openVisibleSpace()
		const minimap = minimapOf(viewer.el) as HTMLElement
		viewer.el.$current?.camera.setDirection(0.5, 0.1)
		await settle(2)
		expect(minimap.classList.contains('hidden')).toBe(false)

		// The element arms a 2.5s hide timer on every draw. Faking the clock would
		// freeze the frame loop the rest of the suite depends on, so this waits it
		// out for real.
		await waitFor(() => minimap.classList.contains('hidden'), 5000, 'minimap to hide after the idle timeout')
		viewer.destroy()
	})

	it('moves the camera when the map is dragged', async () => {
		const { viewer } = await openVisibleSpace()
		const canvas = canvasOf(viewer.el)
		if (!canvas) {
			throw new Error('no minimap canvas')
		}
		stubRect(canvas, 160, 160)

		const before = viewer.el.$current?.camera.getDirection() ?? 0
		await clickMap(canvas, 40, 80)
		expect(viewer.el.$current?.camera.getDirection()).not.toBeCloseTo(before, 2)
		viewer.destroy()
	})

	it('settles the direction at the point that was clicked', async () => {
		const { viewer } = await openVisibleSpace()
		const canvas = canvasOf(viewer.el)
		if (!canvas) {
			throw new Error('no minimap canvas')
		}
		stubRect(canvas, 160, 160)

		// A quarter across the map is a quarter turn; the horizontal centre is a half turn
		await clickMap(canvas, 40, 80)
		const quarter = viewer.el.$current?.camera.getDirection() ?? 0
		await clickMap(canvas, 80, 80)
		const centre = viewer.el.$current?.camera.getDirection() ?? 0

		expect(quarter).not.toBeCloseTo(centre, 2)
		expect(centre).toBeCloseTo(0, 2)
		viewer.destroy()
	})

	it('ignores non-primary mouse buttons', async () => {
		const { viewer } = await openVisibleSpace()
		const canvas = canvasOf(viewer.el)
		if (!canvas) {
			throw new Error('no minimap canvas')
		}
		stubRect(canvas, 160, 160)

		const before = viewer.el.$current?.camera.getDirection() ?? 0
		await clickMap(canvas, 40, 80, 2)
		expect(viewer.el.$current?.camera.getDirection()).toBeCloseTo(before, 6)
		viewer.destroy()
	})

	it('is removed when the viewer is destroyed', async () => {
		const { viewer } = await openVisibleSpace()
		expect(minimapOf(viewer.el)).not.toBeNull()
		viewer.destroy()
		expect(document.body.querySelector('micrio-minimap')).toBeNull()
	})
})
